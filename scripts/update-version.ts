#!/usr/bin/env bun

const newVersion = Bun.argv[2];

if (!newVersion) {
	console.error('Error: Version argument is required');
	console.error('Usage: bun run scripts/update-version.ts <version>');
	process.exit(1);
}

const packagePath = new URL('../package.json', import.meta.url).pathname;
const file = Bun.file(packagePath);
const pkg = await file.json();

pkg.version = newVersion;

await Bun.write(packagePath, JSON.stringify(pkg, null, '\t') + '\n');

console.log(`Updated version to ${newVersion}`);
