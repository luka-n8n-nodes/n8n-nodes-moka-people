import { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Moka People API 凭证。
 *
 * 注意：本凭证只承担「保存敏感信息」的角色，不再使用 n8n 的 `authenticate` 自动注入。
 * Authorization / Query 签名等所有请求构造都由 `MokaRequest`
 *（基于 n8n 内置 `this.helpers.httpRequest`）自行处理，
 * 这样可以与本仓库内的 `requestDemo.js` 行为完全一致，避免 n8n 凭证模板的隐式行为。
 */
export class MokaPeopleApi implements ICredentialType {
	name = 'mokaPeopleApi';
	displayName = 'Moka People API';
	documentationUrl = 'https://people.mokahr.com/docs/api/view/v1.html';
	icon = 'file:../nodes/MokaPeople/icon.svg' as const;
	properties: INodeProperties[] = [
		{
			displayName: 'API 基础地址',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.mokahr.com/api-platform/hcm/oapi',
			required: true,
			description: 'Moka People API 的基础地址，正式环境默认即可',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description:
				'由 Moka People 提供，作为 HTTP Basic Auth 的 username 使用，password 留空。请求头会自动拼接为 "Basic Base64(apiKey:)"',
		},
		{
			displayName: '企业租户 ID (entCode)',
			name: 'entCode',
			type: 'string',
			default: '',
			required: true,
			description: '租户的唯一 ID，由 Moka 客户成功经理（CSM）提供',
		},
		{
			displayName: 'RSA 私钥 (privateKey)',
			name: 'privateKey',
			type: 'string',
			typeOptions: {
				password: true,
				rows: 4,
			},
			default: '',
			required: true,
			placeholder:
				'MIICdgIBADANBgkqhkiG9w0BAQEFAASCAmAwggJcAgEAAoGBAKFrrLHgUMLtvCrrXs/0fdW80gk5n1Ub0+40yr8JyTCOqentsSHy...',
			description:
				'PKCS#8 编码的 RSA 私钥 Base64 字符串（与 Moka 官方 Java/Python 示例一致）。可粘贴裸 Base64，也可粘贴包含 BEGIN/END 头尾的完整 PEM；用于对每次请求做 MD5withRSA 签名生成 sign 参数',
		},
	];
}
