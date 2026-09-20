// Test script for the DSH Task Scheduler (run via `bun run`).
const name = process.env.WHO ?? "world"
console.log(`[tsched-test] hello, ${name}!`)
console.log("args:", process.argv.slice(2).join(", "))
