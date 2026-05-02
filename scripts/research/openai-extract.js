#!/usr/bin/env node
// Usage: node openai-extract.js <file> <field>
// Fields: id | status | error | text
// Reads JSON from <file>, prints requested field to stdout

const fs = require("fs");
const [, , file, field] = process.argv;
if (!file || !field) {
  console.error("Usage: node openai-extract.js <file> <field>");
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.log("parse_error");
  process.exit(0);
}

if (field === "id") {
  console.log(data.id || "");
} else if (field === "status") {
  console.log(data.status || "unknown");
} else if (field === "error") {
  console.log((data.error && (data.error.message || data.error.code)) || "");
} else if (field === "text") {
  let text = "";
  for (const item of data.output || []) {
    if (item.type === "message") {
      for (const c of item.content || []) {
        if (c.type === "output_text") text += c.text + "\n";
      }
    }
  }
  process.stdout.write(text);
} else {
  console.error("Unknown field: " + field);
  process.exit(1);
}
