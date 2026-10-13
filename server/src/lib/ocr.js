/**
 * 付款截图 OCR 识别（tesseract.js，英文数字模式）
 *
 * 只负责两件事：
 * 1. 从截图里提取「交易/转账单号」（纯数字或数字+字母的连续串）
 * 2. 提取「金额」（￥/¥ 附近的数字）
 *
 * 与表单里客户填写的转账单号、系统算出的应付金额做比对
 * 由 routes/public.js 调用，识别结果写入 payment_claims.ocr_note。
 */
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { ROOT } from '../config.js';

const TESSDATA = path.join(ROOT, 'tessdata');
const LANG_PATH = process.env.OCR_LANG_PATH || TESSDATA;

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      langPath: LANG_PATH,
      logging: false,
      cacheMethod: 'read',
      cachePath: path.join(ROOT, 'node_modules', '.cache', 'tesseract'),
    })
      .then(async (w) => {
        // 只识别数字与大写字母，大幅降低中文/噪声干扰，速度也更快
        await w.setParameters({
          tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ¥￥元.',
          preserve_interword_spaces: '1',
        });
        return w;
      })
      .catch((e) => {
        workerPromise = null; // 失败允许下次重建
        throw e;
      });
  }
  return workerPromise;
}

/**
 * 识别付款截图
 * @param {string} imagePath 本地图片路径
 * @returns {Promise<{ text: string, digits: string, amounts: number[] }>}
 */
export async function ocrPaymentShot(imagePath) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imagePath);
  const text = String(data?.text || '').replace(/\s+/g, ' ');
  // 数字/字母连续串（交易号等）
  const digits = (text.match(/[0-9A-Za-z]{8,}/g) || []).map((s) => s.toUpperCase());
  // 金额：¥/￥ 后的数字，或独立的 xx.xx
  const amounts = [];
  for (const m of text.matchAll(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/g)) {
    const v = Number(m[1]);
    if (v > 0 && v < 100000) amounts.push(Math.round(v * 100) / 100);
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,4}\.\d{2})(?!\d)/g)) {
    const v = Number(m[1]);
    if (v > 0 && v < 100000) amounts.push(Math.round(v * 100) / 100);
  }
  return { text: text.slice(0, 2000), digits, amounts };
}
