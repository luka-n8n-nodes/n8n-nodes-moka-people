import { ResourceOptions } from '../../help/type/IResource';

/**
 * BI 报表资源定义
 *
 * 对应 Moka People API → HCM BI 报表相关接口。
 */
const resource: ResourceOptions = {
	name: 'BI报表',
	value: 'biReport',
	description: 'Moka People BI 报表相关接口',
	order: 30,
};

export default resource;
