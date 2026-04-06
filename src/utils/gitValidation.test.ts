import { test, describe } from "node:test";
import * as assert from "node:assert";
import { isValidRef } from "./gitValidation.ts";

describe("gitValidation - isValidRef", () => {
  describe("Happy paths", () => {
    const validRefs = [
      "HEAD",
      ":0",
      "main",
      "feature/branch-name",
      "bugfix_123",
      "v1.0.0",
      "stash@{0}",
      "stash@{12}",
      "a1b2c3d4e5f6", // commit hash
      "file.txt",
      "src/index.ts"
    ];

    for (const ref of validRefs) {
      test(`should accept valid ref: ${ref}`, () => {
        assert.strictEqual(isValidRef(ref), true);
      });
    }
  });

  describe("Edge cases and Error conditions", () => {
    test("should reject empty string", () => {
      assert.strictEqual(isValidRef(""), false);
    });

    test("should reject non-string types", () => {
      assert.strictEqual(isValidRef(null as any), false);
      assert.strictEqual(isValidRef(undefined as any), false);
      assert.strictEqual(isValidRef(123 as any), false);
      assert.strictEqual(isValidRef({} as any), false);
    });

    test("should accept exactly 255 chars", () => {
      const longRef = "a".repeat(255);
      assert.strictEqual(isValidRef(longRef), true);
    });

    test("should reject strings of length 256 or more", () => {
      const tooLongRef = "a".repeat(256);
      assert.strictEqual(isValidRef(tooLongRef), false);

      const evenLongerRef = "a".repeat(300);
      assert.strictEqual(isValidRef(evenLongerRef), false);
    });
  });

  describe("Shell injection and Flag injection", () => {
    const maliciousRefs = [
      "-n1", // flag injection
      "--exec=malicious", // flag injection
      "main; rm -rf /", // semicolon injection
      "HEAD & echo 'hacked'", // ampersand injection
      "branch | grep secret", // pipe injection
      "$(whoami)", // command substitution
      "`whoami`", // command substitution
      "echo $USER", // environment variable
      "stash@{0} { echo 'hacked' }", // curly braces
      "HEAD () { echo 'hacked' }" // parentheses
    ];

    for (const ref of maliciousRefs) {
      test(`should reject malicious ref: ${ref}`, () => {
        assert.strictEqual(isValidRef(ref), false);
      });
    }
  });
});
