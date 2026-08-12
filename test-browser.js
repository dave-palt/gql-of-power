// Minimal browser simulation — no Node globals beyond what a browser has
// This catches the exact class of error that breaks in the preview pane.

// Clear ALL node globals that wouldn't exist in a browser
globalThis.window = globalThis;
globalThis.process = { env: { D3GOP_LOG_TYPE: 'disabled' } };

// DON'T provide require, Buffer, __dirname, setImmediate — browsers don't have these

// Suppress console noise
console.time = () => {};
console.timeLog = () => {};
console.timeEnd = () => {};
console.warn = () => {};

try {
	const fs = require('fs');
	const code = fs.readFileSync(require('path').join(__dirname, 'dist/main.js'), 'utf8');
	eval(code);

	if (typeof window.gqlOfPower === 'object' && window.gqlOfPower.generateSQL) {
		const r = window.gqlOfPower.generateSQL('query { persons { id name } }');
		console.log(r.error ? 'RESULT: ERROR: ' + r.error : 'RESULT: OK');
	} else {
		console.log('RESULT: FAIL - gqlOfPower not on window');
	}
} catch (e) {
	console.log('CRASH: ' + (e.message || e));
	// Print the first few lines of stack
	if (e.stack) console.log(e.stack.split('\n').slice(0, 5).join('\n'));
}
