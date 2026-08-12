// Browser simulation harness — mimics what a <script> tag does
globalThis.window = globalThis;
globalThis.process = { env: { D3GOP_LOG_TYPE: 'disabled' } };
globalThis.document = { createElement: () => ({}), getElementsByTagName: () => [] };

// Suppress console noise
console.time = () => {};
console.timeLog = () => {};
console.timeEnd = () => {};
console.warn = () => {};

// Load the bundle
const fs = require('fs');
const code = fs.readFileSync(require('path').join(__dirname, 'dist/main.js'), 'utf8');
eval(code);

// Check
if (typeof window.gqlOfPower === 'object' && window.gqlOfPower.generateSQL) {
	const tests = [
		['Simple', 'query { persons { id name race } }'],
		['1:m + count', 'query { fellowships { id name memberCount members { id name race } } }'],
		['filter', 'query { persons(filter: { race_eq: "Hobbit" }) { id name } }'],
	];
	let pass = 0;
	for (const [label, q] of tests) {
		const r = window.gqlOfPower.generateSQL(q);
		if (r.error) {
			console.log('FAIL: ' + label + ' — ' + r.error);
		} else {
			console.log('PASS: ' + label);
			pass++;
		}
	}
	console.log('\n' + pass + '/' + tests.length + ' passed — engine loaded correctly');
} else {
	console.log('FAIL: window.gqlOfPower not found — engine did not load');
	process.exit(1);
}
