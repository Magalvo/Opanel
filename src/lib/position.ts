/**
 * Ordering keys for columns and cards (canonical doc 0002 section 4, WT-03 decision 5,
 * WS-027). A key can always be generated between two others, so moving one item writes one
 * row and other rows keep their keys.
 *
 * Keys use the 62 ASCII digits and letters and are compared by UTF-16 code unit: in
 * JavaScript with `<` and `>`, in PostgreSQL under `COLLATE "C"` (amendment A2). Never
 * compare them with `localeCompare` or a language collation, which order `"aZ"` and `"aa"`
 * the other way round.
 *
 * The scheme is David Greenspan's "fractional indexing": an integer part whose head
 * character gives its length (`a` one digit, `b` two, ... `z` 26; `Z` one digit for a
 * negative integer, ... `A` 26), then an optional fraction that never ends in `0`. Appending
 * increments the integer part, so keys stay short on lists that mostly grow at the end.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = "0";
const LAST_DIGIT = "z";
const BASE = DIGITS.length;
/** The smallest integer part. It cannot be decremented, so it never starts a key on its own. */
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;
const KEY_CHARACTERS = /^[0-9A-Za-z]+$/;

function digitValue(digit: string): number {
  return DIGITS.indexOf(digit);
}

function digitAt(value: number): string {
  const digit = DIGITS[value];
  if (digit === undefined) throw new Error(`No digit for ${String(value)}.`);
  return digit;
}

/** Length of the integer part announced by its head character. */
function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`Invalid position key head: ${head}`);
}

function integerPart(key: string): string {
  const length = integerLength(key.charAt(0));
  if (length > key.length) throw new Error(`Invalid position key: ${key}`);
  return key.slice(0, length);
}

function assertKey(key: string): void {
  if (!KEY_CHARACTERS.test(key) || key === SMALLEST_INTEGER) {
    throw new Error(`Invalid position key: ${key}`);
  }
  const integer = integerPart(key);
  if (key.length > integer.length && key.endsWith(ZERO)) {
    throw new Error(`Invalid position key: ${key}`);
  }
}

/** True if `key` is a well-formed key of this scheme. */
export function isPositionKey(key: string): boolean {
  try {
    assertKey(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * A fraction strictly between fractions `a` and `b` (`b` null: no upper bound). Neither
 * ends in `0`; `a` may be empty (zero).
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`${a} is not before ${b}`);
  if (a.endsWith(ZERO) || (b?.endsWith(ZERO) ?? false)) {
    throw new Error("A fraction cannot end in 0.");
  }

  if (b !== null) {
    // Skip the common prefix, reading a missing digit of `a` as 0.
    let shared = 0;
    while ((a.charAt(shared) || ZERO) === b.charAt(shared)) shared += 1;
    if (shared > 0) {
      return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
    }
  }

  const low = a === "" ? 0 : digitValue(a.charAt(0));
  const high = b === null ? BASE : digitValue(b.charAt(0));
  if (high - low > 1) {
    return digitAt(Math.round((low + high) / 2));
  }
  // The first digits are consecutive.
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }
  return digitAt(low) + midpoint(a.slice(1), null);
}

/** The next integer part, or null past the largest one. */
function increment(integer: string): string | null {
  const head = integer.charAt(0);
  const digits = integer.slice(1).split("");
  let carry = true;
  for (let index = digits.length - 1; carry && index >= 0; index -= 1) {
    const next = digitValue(digits[index] ?? ZERO) + 1;
    if (next === BASE) {
      digits[index] = ZERO;
    } else {
      digits[index] = digitAt(next);
      carry = false;
    }
  }
  if (!carry) return head + digits.join("");
  if (head === "Z") return `a${ZERO}`;
  if (head === "z") return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > "a") digits.push(ZERO);
  else digits.pop();
  return nextHead + digits.join("");
}

/** The previous integer part, or null below the smallest one. */
function decrement(integer: string): string | null {
  const head = integer.charAt(0);
  const digits = integer.slice(1).split("");
  let borrow = true;
  for (let index = digits.length - 1; borrow && index >= 0; index -= 1) {
    const previous = digitValue(digits[index] ?? ZERO) - 1;
    if (previous === -1) {
      digits[index] = LAST_DIGIT;
    } else {
      digits[index] = digitAt(previous);
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join("");
  if (head === "a") return `Z${LAST_DIGIT}`;
  if (head === "A") return null;
  const previousHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (previousHead < "Z") digits.push(LAST_DIGIT);
  else digits.pop();
  return previousHead + digits.join("");
}

/**
 * A key strictly between `before` and `after`; `null` means no neighbour on that side.
 * Throws a plain `Error` (a programming mistake) for a malformed key or `before >= after`.
 */
export function positionBetween(before: string | null, after: string | null): string {
  if (before !== null) assertKey(before);
  if (after !== null) assertKey(after);
  if (before !== null && after !== null && before >= after) {
    throw new Error(`${before} is not before ${after}`);
  }

  if (before === null) {
    if (after === null) return `a${ZERO}`;
    const integer = integerPart(after);
    const fraction = after.slice(integer.length);
    if (integer === SMALLEST_INTEGER) return integer + midpoint("", fraction);
    if (integer < after) return integer;
    const previous = decrement(integer);
    if (previous === null) throw new Error("No key exists before this one.");
    return previous;
  }

  const integer = integerPart(before);
  const fraction = before.slice(integer.length);
  if (after === null) {
    const next = increment(integer);
    return next ?? integer + midpoint(fraction, null);
  }

  const afterInteger = integerPart(after);
  if (integer === afterInteger) {
    return integer + midpoint(fraction, after.slice(afterInteger.length));
  }
  const next = increment(integer);
  if (next === null) throw new Error("No key exists after this one.");
  return next < after ? next : integer + midpoint(fraction, null);
}

/** `count` keys in order, all strictly between `before` and `after`. */
export function positionsBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Invalid count: ${String(count)}`);
  }
  if (count === 0) return [];
  if (count === 1) return [positionBetween(before, after)];

  if (after === null) {
    const keys: string[] = [];
    let last = before;
    for (let index = 0; index < count; index += 1) {
      last = positionBetween(last, null);
      keys.push(last);
    }
    return keys;
  }
  if (before === null) {
    const keys: string[] = [];
    let first: string = after;
    for (let index = 0; index < count; index += 1) {
      first = positionBetween(null, first);
      keys.unshift(first);
    }
    return keys;
  }

  // Bisect, so the keys share the gap instead of crowding at one end.
  const half = Math.floor(count / 2);
  const middle = positionBetween(before, after);
  return [
    ...positionsBetween(before, middle, half),
    middle,
    ...positionsBetween(middle, after, count - half - 1),
  ];
}
