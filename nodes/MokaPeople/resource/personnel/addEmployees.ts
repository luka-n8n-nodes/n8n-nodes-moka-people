import { IDataObject, INodeProperties } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import { parseJsonArray, timeoutOption } from '../../../help/utils/sharedOptions';

/**
 * 新增员工接口
 * 接口路径：POST /v2/core/rosters/addEmployees
 * 文档：https://people.mokahr.com/docs/api/view/v1.html#-97
 *
 * Query Params 由 MokaRequest 自动注入（含 entCode / apiCode / nonce / timestamp / sign）。
 * 该接口与「员工任职数据」不同，签名 Query 不含 userName。
 *
 * 请求体（Body）字段较多且嵌套复杂（含证件、合同、组织、自定义字段等），
 * 因此本节点直接暴露一个 JSON 字段供调用方完整透传，避免在节点上枚举上百个字段。
 *
 * 响应：直接透出 Moka 业务体 data 节点（结构同样以官方文档为准）。
 */

const PATH = '/v2/core/rosters/addEmployees';

const DEFAULT_DATA_TEMPLATE = JSON.stringify(
	[
		{
			realname: '员工姓名',
			employee_no: 'GH202404231942',
			begin_work_time: 1701328531000,
			company_start_date: 1635750931000,
		},
	],
	null,
	2,
);

const properties: INodeProperties[] = [
	{
		displayName:
			'新增员工接口，详细字段含义与示例请参考：' +
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
			'在 Moka People 后台「设置」→「对外接口设置」中为「新增员工接口」配置的接口编码',
	},
	{
		displayName: '员工数据 (Data)',
		name: 'data',
		type: 'json',
		typeOptions: {
			rows: 12,
		},
		default: DEFAULT_DATA_TEMPLATE,
		required: true,
		description:
			'只需填写数组 JSON（<code>[{...}, {...}]</code>），每个对象代表一名待新增员工，代码会自动包装为 <code>{ "data": [...] }</code> 发送。' +
			'员工字段（如 realname、employee_no、begin_work_time、id_no、contract、avatarUrl 等）请参考' +
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
	name: '新增员工',
	value: 'addEmployees',
	description: '新增员工 (POST /v2/core/rosters/addEmployees)',
	action: '新增员工',
	order: 20,
	options: properties,
	call: async function (index) {
		const apiCode = (this.getNodeParameter('apiCode', index, '') as string).trim();
		const optionsParam = this.getNodeParameter('options', index, {}) as { timeout?: number };
		const timeout = Number(optionsParam.timeout ?? 0) > 0 ? Number(optionsParam.timeout) : 0;

		const rawData = this.getNodeParameter('data', index, '') as unknown;
		const dataArray = parseJsonArray(rawData);

		const data = await mokaRequest(this, {
			method: 'POST',
			path: PATH,
			body: { data: dataArray } as IDataObject,
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
