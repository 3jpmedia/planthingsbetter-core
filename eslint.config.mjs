import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts", "tests/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.*"],
				},
			},
		},
	},
	{
		// Unit tests run under Vitest in Node — Node built-ins and globals are
		// expected there.
		files: ["tests/**/*.ts"],
		languageOptions: {
			globals: {
				__dirname: "readonly",
				__filename: "readonly",
				process: "readonly",
			},
		},
	},
	{
		ignores: ["dist/**", "node_modules/**"],
	},
);
