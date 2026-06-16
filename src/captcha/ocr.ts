import fs from 'node:fs/promises';
import { resolve } from 'node:path';

import { Jimp } from 'jimp';
import { Tensor } from 'onnxruntime-web';

import { config } from '@/config';
import { ROOT_PATH } from '@/utils/path';

import { BaseOrtservice } from './base/ort';

interface MathResult {
  formula: string;
  result: number;
}

interface TextResult {
  code: string;
}

export type OcrResult = MathResult | TextResult;

export class OcrCaptchaService extends BaseOrtservice {
  private static instance: OcrCaptchaService | null = null;
  private charsetRanges: Set<string> = new Set<string>();

  public static getInstance(): OcrCaptchaService {
    if (!OcrCaptchaService.instance) {
      OcrCaptchaService.instance = new OcrCaptchaService();
    }
    return OcrCaptchaService.instance;
  }

  public async init(): Promise<void> {
    const modelPath = resolve(ROOT_PATH, config.ocr.modelPath);
    const charsetPath = resolve(ROOT_PATH, config.ocr.charsetPath);

    try {
      await fs.access(modelPath);
      await fs.access(charsetPath);
    } catch {
      throw new Error('ONNX model or charset file not found');
    }

    // const model = await fs.readFile(modelPath);
    // await this.loadModel(model);
    await this.loadModel(modelPath);

    const charset = await fs.readFile(charsetPath, 'utf-8');
    await this.loadCharset(charset);

    if (config.ocr.charsetRanges) this.setRanges(config.ocr.charsetRanges.split(''));
  }

  private setRanges(ranges: string[]) {
    if (!ranges.length && this.charsetRanges.size > 0) this.charsetRanges.clear();
    else this.charsetRanges = new Set(ranges);
  }

  private async preproc(base64: string): Promise<{
    floatData: Float32Array;
    size: { height: number; width: number };
    rawSize: { height: number; width: number };
  }> {
    const MEAN = 0.5; // [0.485, 0.456, 0.406];
    const STD = 0.5; // [0.229, 0.224, 0.225];
    const TARGET_SIZE = [0, 64];
    const [_TARGET_WIDTH, TARGET_HEIGHT] = TARGET_SIZE;

    const image = await Jimp.read(Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
    const { width: rawWidth, height: rawHeight } = image.bitmap;

    const newWidth = Math.max(1, Math.floor(rawWidth * (TARGET_HEIGHT / rawHeight)));
    const newHeight = TARGET_HEIGHT;

    image.resize({ w: newWidth, h: newHeight }); // 缩放
    image.greyscale(); // sRGB gamma-corrected 优于 luminance

    const { data, width, height } = image.bitmap;
    const channelSize = width * height;
    const floatData = new Float32Array(channelSize);

    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      floatData[j] = (data[i] / 255.0 - MEAN) / STD; // ddddocr 1.6.1

      // 1.5.5
      // floatData[j] = (data[i] / 255.0 - MEAN[0]) / STD[0];
      // floatData[channelSize + j] = (data[i + 1] / 255.0 - MEAN[1]) / STD[1];
      // floatData[2 * channelSize + j] = (data[i + 2] / 255.0 - MEAN[2]) / STD[2];
    }

    return {
      floatData,
      size: { height, width },
      rawSize: { height: rawHeight, width: rawWidth },
    };
  }

  public async text(bgBase64: string, ranges?: Set<string>): Promise<TextResult> {
    const { floatData, size } = await this.preproc(bgBase64);

    // ONNX 推理
    const { output } = await this.run(new Tensor('float32', floatData, [1, 1, size.height, size.width]));

    const vocab = this.charset;

    // 构建允许字符的索引集合（用于解码时过滤，参考 ddddocr PR #234）
    const allowedSet = (() => {
      if (ranges && ranges.size > 0) return ranges;
      if (this.charsetRanges.size > 0) return this.charsetRanges;
      return null;
    })();

    const allowedIndices = allowedSet
      ? new Set(vocab.reduce<number[]>((acc, char, idx) => {
          if (allowedSet.has(char)) acc.push(idx);
          return acc;
        }, []))
      : undefined;

    // CTC 解码（限制在 allowedIndices 范围内 argmax）
    const ctcDecode = this.ctcGreedyDecode(output, vocab, { blankIndex: 0, allowedIndices });
    const text = typeof ctcDecode === 'string' ? ctcDecode : ctcDecode[0];
    console.debug(`text ctc decode: ${text}`);

    return { code: text };
  }

  public async math(bgBase64: string): Promise<MathResult> {
    // prettier-ignore
    const ranges = new Set([
      ...'0123456789',
      ...'０１２３４５６７８９', // U+FF10 - U+FF19
      ...'①②③④⑤⑥⑦⑧⑨',
      ...'零一二三四五六七八九',
      ...'〇壹贰叁肆伍陆柒捌玖',

      ...'加减乘除等',
      ...'+-*/=?',
      ...'＋－–×ⅩⅹxX÷＝？',

      ...'oOｏＯΟОDＤ', // 0
      ...'lIｌＩіⅰⅠ', // 1
      ...'zZｚＺ', // 2
      ...'sSｓＳ', // 5
      ...'bBｂＢ', // 8
      ...'gqＧＱ', // 9
    ]);

    const mapChars = (chars: string, value: string): Record<string, string> => {
      return Object.fromEntries([...chars].map((char) => [char, value]));
    };

    const replaceMap: Record<string, string> = {
      // 数字
      ...mapChars('oOｏＯΟОDＤ', '0'),
      ...mapChars('lIｌＩіⅰⅠ', '1'),
      ...mapChars('zZｚＺ', '2'),
      ...mapChars('sSｓＳ', '5'),
      ...mapChars('bBｂＢ', '8'),
      ...mapChars('gqＧＱ', '9'),

      // 运算符
      ...mapChars('加＋', '+'),
      ...mapChars('减－–', '-'),
      ...mapChars('乘×ⅩⅹxX', '*'),
      ...mapChars('除÷', '/'),
    };

    const { code } = await this.text(bgBase64, ranges);

    // prettier-ignore
    const formula = code
      .normalize('NFKC') // 规范化字符格式
      .replace(/7$/, '') // 移除末尾 7（识别错误率高）
      .split('').map(char => replaceMap[char] ?? char).join('') // 修正

      .replace(/[零〇]/g, '0')  
      .replace(/[一壹①]/g, '1')
      .replace(/[二贰②]/g, '2')
      .replace(/[三叁③]/g, '3')
      .replace(/[四肆④]/g, '4')
      .replace(/[五伍⑤]/g, '5')
      .replace(/[六陆⑥]/g, '6')
      .replace(/[七柒⑦]/g, '7')
      .replace(/[八捌⑧]/g, '8')
      .replace(/[九玖⑨]/g, '9')

      .replace(/[等=?？]/g, '') // 删除不执行字符
      .replace(/[^0-9+\-*/]/g, ''); // 允许数学表达式

    if (!formula) throw new Error('Formula expression error');

    let result: unknown;
    try {
      result = Function(`"use strict"; return (${formula})`)();
    } catch {
      throw new Error('Invalid formula expression');
    }

    if (typeof result !== 'number' || Number.isNaN(result)) {
      throw new Error('Invalid formula expression result');
    }

    return { formula, result };
  }
}

export const ocrCaptchaService = OcrCaptchaService.getInstance();
