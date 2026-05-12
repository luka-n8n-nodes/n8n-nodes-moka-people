import { IDataObject, INodeProperties } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import { parseJsonArray, timeoutOption } from '../../../help/utils/sharedOptions';

/**
 * 员工基本信息回写接口（写入）
 * 接口路径：POST /v2/core/rosters/writeEmployeeBasicInfo
 * 文档：https://people.mokahr.com/docs/api/view/v1.html#-97
 *
 * 通过此接口，可以回写员工个人信息 - 联系方式的数据记录。
 * Query Params 由 MokaRequest 自动注入（含 entCode / apiCode / nonce / timestamp / sign）。
 * 该接口不需要 userName。
 */

const PATH = '/v2/core/rosters/writeEmployeeBasicInfo';

const DEFAULT_DATA_TEMPLATE = JSON.stringify(
	[
		{
			employeeId: 75714361,
			oneOnOneChildObjectMap: {
				'contact-office_phone': '110911',
				'contact-telephone': {
					countryCode: '86',
					value: '18800000000',
				},
				'contact-office_email': 'moka@email.com',
				'contact-personal_email': 'moka@email.com',
			},
		},
	],
	null,
	2,
);

const properties: INodeProperties[] = [
	{
		displayName:
			'员工基本信息回写接口，可回写员工个人信息 - 联系方式的数据记录。详细文档请参考：' +
			'<a href="https://people.mokahr.com/docs/api/view/v1.html#-97" target="_blank">' +
			'https://people.mokahr.com/docs/api/view/v1.html#-97</a>',
		name: 'noticeDoc',
		type: 'notice',
		default: '',
	},
	{
		displayName: '接口编码 (apiCode)',
		name: 'apiCode',
		type: 'string',
		default: '',
		required: true,
		description:
			'在 Moka People 后台「设置」→「对外接口设置」中为「员工基本信息回写」接口配置的接口编码',
	},
	{
		displayName: '回写数据 (employeeWriteBasicInfoList)',
		name: 'employeeWriteBasicInfoList',
		type: 'json',
		typeOptions: {
			rows: 16,
		},
		default: DEFAULT_DATA_TEMPLATE,
		required: true,
		description:
			'只需填写数组 JSON（<code>[{...}, {...}]</code>），每个对象包含 employeeId 和 oneOnOneChildObjectMap（联系方式键值对），' +
			'代码会自动包装为 <code>{ "employeeWriteBasicInfoList": [...] }</code> 发送。' +
			'支持的字段如 contact-office_phone、contact-telephone、contact-office_email、contact-personal_email 等，请参考' +
			'<a href="https://people.mokahr.com/docs/api/view/v1.html#-97" target="_blank">官方文档</a>',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [timeoutOption()],
	},
];

const operation: ResourceOperations = {
	name: '员工基本信息回写',
	value: 'writeEmployeeBasicInfo',
	description: '回写员工联系方式 (POST /v2/core/rosters/writeEmployeeBasicInfo)',
	action: '员工基本信息回写',
	order: 50,
	options: properties,
	call: async function (index) {
		const apiCode = (this.getNodeParameter('apiCode', index, '') as string).trim();
		const optionsParam = this.getNodeParameter('options', index, {}) as { timeout?: number };
		const timeout = Number(optionsParam.timeout ?? 0) > 0 ? Number(optionsParam.timeout) : 0;

		const rawData = this.getNodeParameter('employeeWriteBasicInfoList', index, '') as unknown;
		const dataArray = parseJsonArray(rawData);

		const data = await mokaRequest(this, {
			method: 'POST',
			path: PATH,
			body: { employeeWriteBasicInfoList: dataArray } as IDataObject,
			apiCode,
			itemIndex: index,
			timeout,
		});

		if (Array.isArray(data)) {
			return data as IDataObject[];
		}
		if (data && typeof data === 'object') {
			return data as IDataObject;
		}
		return { data } as IDataObject;
	},
};

export default operation;
