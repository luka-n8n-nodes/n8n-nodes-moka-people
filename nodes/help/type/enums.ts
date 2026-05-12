/**
 * 凭证类型常量。
 *
 * 之所以使用 `const + as const` 而非 `declare const enum`：
 * - `declare const enum` 在 `isolatedModules: true` 下会编译报错，且无法跨模块复用；
 * - `const + as const` 同样能拿到字面量类型推断（`'mokaPeopleApi'`），且对未来切换到
 *   SWC / esbuild 构建管线友好。
 */
export const Credentials = {
	MokaPeopleApi: 'mokaPeopleApi',
} as const;
export type CredentialsKey = (typeof Credentials)[keyof typeof Credentials];

/**
 * Moka People API 的成功响应 code（0 / 200 代表成功）。
 *
 * 默认值，调用方可在 `mokaRequest` 入参里传入 `successCodes` 覆盖。
 */
export const MokaSuccessCodes: ReadonlyArray<number> = [0, 200];
