import {durationMs} from './duration.mjs';
export function summarize(values) { return { count: values.length, totalMs: values.map(durationMs).reduce((a,b)=>a+b,0), maxMs: 0 }; }
