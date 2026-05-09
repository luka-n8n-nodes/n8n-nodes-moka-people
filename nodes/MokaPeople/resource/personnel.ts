import { ResourceOptions } from '../../help/type/IResource';

/**
 * 人事接口资源定义
 *
 * 对应 Moka People API → HCM 人事相关接口（员工任职、员工关联信息等）。
 */
const resource: ResourceOptions = {
	name: '人事接口',
	value: 'personnel',
	description: 'Moka People 人事相关接口',
	order: 10,
};

export default resource;
