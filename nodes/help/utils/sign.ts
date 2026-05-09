import { createSign, randomBytes } from 'crypto';

/**
 * 生成 nonce（默认 8 位字符，由数字和小写字母构成）。
 *
 * Moka People API 要求 nonce 长度不超过 10 位、5 分钟内不重复。
 */
export function generateNonce(length = 8): string {
	const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = randomBytes(length);
	let result = '';
	for (let i = 0; i < length; i += 1) {
		result += charset[bytes[i] % charset.length];
	}
	return result;
}

/**
 * 按字典序拼接待签名字符串。
 *
 * 规则：
 * 1. 过滤掉 sign 字段、null/undefined 字段
 * 2. 按 key 字典序升序排序
 * 3. 拼接为 `k1=v1&k2=v2&...`，value 使用原始字符串（不做 url-encode）
 *
 * 示例输出：`apiCode=0001&entCode=1&nonce=999&timestamp=1565244098737`
 */
export function buildStringToSign(params: Record<string, string | number>): string {
	const keys = Object.keys(params)
		.filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null)
		.sort();

	return keys.map((key) => `${key}=${params[key]}`).join('&');
}

/**
 * 将 Moka 后台导出的裸 Base64 私钥（PKCS#8 编码）规范化为 PEM 格式。
 *
 * 兼容场景：
 * 1. 裸 Base64 字符串（如 Moka 官方 Java/Python 示例）—— 自动加上 BEGIN/END 头尾，并按 64 字符换行
 * 2. 已是完整 PEM（含 `-----BEGIN ... PRIVATE KEY-----`）—— 原样返回，不做修改
 */
export function normalizePrivateKey(privateKey: string): string {
	const trimmed = (privateKey ?? '').trim();
	if (!trimmed) {
		throw new Error('RSA 私钥不能为空');
	}

	if (trimmed.includes('-----BEGIN') && trimmed.includes('PRIVATE KEY-----')) {
		return trimmed;
	}

	const base64 = trimmed.replace(/\s+/g, '');
	const lines = base64.match(/.{1,64}/g) ?? [base64];

	return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----'].join('\n');
}

/**
 * 使用 RSA 私钥对字符串做 MD5withRSA 签名，返回 Base64 编码后的签名。
 *
 * privateKey 支持两种格式：
 * - 裸 Base64 字符串（PKCS#8 编码，与 Moka 官方示例一致）
 * - 完整 PEM 字符串（含 `-----BEGIN PRIVATE KEY-----` 头尾）
 *
 * 内部会调用 {@link normalizePrivateKey} 自动规范化。
 */
export function rsaSign(stringToSign: string, privateKey: string): string {
	const pem = normalizePrivateKey(privateKey);
	const signer = createSign('RSA-MD5');
	signer.update(stringToSign, 'utf8');
	signer.end();
	return signer.sign(pem, 'base64');
}

/**
 * 一站式生成完整的 Query 参数（含 nonce / timestamp / sign）。
 *
 * 用法：
 * ```ts
 * const query = buildSignedQuery(
 *   { entCode: 'xxx', apiCode: 'yyy' },
 *   credentials.privateKey,
 * );
 * // 把 query 作为 qs 参数传给 n8n 的 httpRequest
 * ```
 *
 * 内部行为：
 * 1. 若 params 已包含 nonce / timestamp 则保留，否则自动注入
 * 2. 调用 buildStringToSign + rsaSign 得到 sign
 * 3. 返回完整对象：{ ...params, nonce, timestamp, sign }
 */
export function buildSignedQuery(
	params: Record<string, string | number>,
	privateKey: string,
): Record<string, string> {
	const merged: Record<string, string | number> = {
		...params,
		nonce: params.nonce ?? generateNonce(),
		timestamp: params.timestamp ?? Date.now(),
	};

	const stringToSign = buildStringToSign(merged);
	const sign = rsaSign(stringToSign, privateKey);

	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(merged)) {
		result[key] = String(value);
	}
	result.sign = sign;
	return result;
}
