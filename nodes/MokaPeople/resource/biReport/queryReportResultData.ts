import { IDataObject, INodeProperties } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import { timeoutOption } from '../../../help/utils/sharedOptions';

/**
 * 查询报表结果数据接口
 * 接口路径：POST /v1/report/getReportData
 * 文档：Moka People API → HCM → BI 报表 → 查询报表结果数据
 *
 * Query Params 由 MokaRequest 自动注入（含 entCode / apiCode / nonce / timestamp / sign）。
 * 该接口不需要 userName。
 *
 * Request Body:
 * - reportId (int, 必填): 报表 ID
 */

const PATH = '/v1/report/getReportData';

/** BI 报表接口的业务成功 code（区别于其它接口的 0 / 200） */
const REPORT_SUCCESS_CODES: ReadonlyArray<number> = [1000000];

/**
 * BI 报表表头节点（支持多级 children）。
 */
interface IReportHeader {
	dataIndex?: string;
	title?: string;
	type?: string;
	children?: IReportHeader[];
}

/**
 * 递归收集 dataIndex → title 映射（含多级表头）。
 */
function collectHeaderMappings(headers: unknown): Map<string, string> {
	const mappings = new Map<string, string>();
	if (!Array.isArray(headers)) return mappings;

	for (const header of headers) {
		if (!header || typeof header !== 'object') continue;
		const h = header as IReportHeader;
		if (h.dataIndex && h.title) {
			mappings.set(h.dataIndex, h.title);
		}
		if (Array.isArray(h.children)) {
			for (const [dataIndex, title] of collectHeaderMappings(h.children)) {
				mappings.set(dataIndex, title);
			}
		}
	}
	return mappings;
}

/**
 * 将 BI 报表原始 rows（c_1 / c_2 …）转换为以表头 title 为 key 的对象数组。
 */
function transformReportRows(data: IDataObject): IDataObject[] {
	const rows = data.rows;
	if (!Array.isArray(rows)) return [];

	const mappings = collectHeaderMappings(data.headers);
	return rows.map((row) => {
		if (!row || typeof row !== 'object') return {} as IDataObject;
		const record = row as IDataObject;
		const result: IDataObject = {};
		for (const [dataIndex, title] of mappings) {
			if (dataIndex in record) {
				result[title] = record[dataIndex];
			}
		}
		return result;
	});
}

const properties: INodeProperties[] = [
	{
		displayName: '接口编码 (apiCode)',
		name: 'apiCode',
		type: 'string',
		default: '',
		required: true,
		description:
			'在 Moka People 后台「设置」→「对外接口设置」中为「查询报表结果数据」接口配置的接口编码',
	},
	{
		displayName: '报表 ID (reportId)',
		name: 'reportId',
		type: 'number',
		default: 0,
		required: true,
		description: '要查询的 BI 报表 ID',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [
			{
				displayName: 'Transform Data',
				name: 'transformData',
				type: 'boolean',
				default: false,
				description:
					'Whether to transform report rows into objects keyed by header titles (e.g. {"性别":"男性","民族":"汉族"})',
			},
			timeoutOption(),
		],
	},
];

const operation: ResourceOperations = {
	name: '查询报表结果数据',
	value: 'queryReportResultData',
	description: '查询 BI 报表结果数据 (POST /v1/report/getReportData)',
	action: '查询报表结果数据',
	order: 10,
	options: properties,
	call: async function (index) {
		const apiCode = (this.getNodeParameter('apiCode', index, '') as string).trim();
		const reportId = this.getNodeParameter('reportId', index, 0) as number;
		const optionsParam = this.getNodeParameter('options', index, {}) as {
			timeout?: number;
			transformData?: boolean;
		};
		const timeout = Number(optionsParam.timeout ?? 0) > 0 ? Number(optionsParam.timeout) : 0;
		const transformData = optionsParam.transformData === true;

		const data = await mokaRequest(this, {
			method: 'POST',
			path: PATH,
			body: { reportId },
			apiCode,
			itemIndex: index,
			timeout,
			// BI 报表接口的成功 code 为 1000000，非 1000000 视为业务错误
			successCodes: REPORT_SUCCESS_CODES,
		});

		if (transformData && data && typeof data === 'object' && !Array.isArray(data)) {
			return transformReportRows(data as IDataObject);
		}

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
