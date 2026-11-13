const YOCTO_PER_NEAR = 10n ** 24n;
const MAX_U128 = (1n << 128n) - 1n;

export function toYocto(amount) {
  if (typeof amount !== "string" || !/^(0|[1-9]\d*)(?:\.\d{1,24})?$/.test(amount)) {
    throw new Error("Use a decimal NEAR string with at most 24 fractional digits.");
  }
  const [whole, fraction = ""] = amount.split(".");
  const value = BigInt(whole) * YOCTO_PER_NEAR + BigInt(fraction.padEnd(24, "0"));
  if (value <= 0n || value > MAX_U128) {
    throw new Error("Amount must be positive and fit in an unsigned 128-bit integer.");
  }
  return value.toString();
}

export function formatNear(yocto) {
  if (typeof yocto !== "string" || !/^\d+$/.test(yocto)) {
    throw new Error("Expected an integer yoctoNEAR string.");
  }
  const value = BigInt(yocto);
  const whole = value / YOCTO_PER_NEAR;
  const fraction = (value % YOCTO_PER_NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}
