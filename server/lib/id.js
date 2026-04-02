let seq = 0;
const EPOCH = 1704067200000n; // 2024-01-01T00:00:00Z

function generateId() {
  const ts = BigInt(Date.now()) - EPOCH;
  const id = (ts << 22n) | BigInt(seq++ & 0xFFF);
  return id.toString();
}

module.exports = { generateId };
