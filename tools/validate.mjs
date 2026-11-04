import { validateContent } from '../src/data/validate.js';
const errs = validateContent();
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
console.log('content ok');
