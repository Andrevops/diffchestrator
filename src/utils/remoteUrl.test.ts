import * as assert from "node:assert";
import { test, describe } from "node:test";
import { toBrowsableUrl, stripCredentials } from "./remoteUrl.ts";

describe("toBrowsableUrl", () => {
  test("https remotes keep scheme/host, drop .git", () => {
    assert.strictEqual(toBrowsableUrl("https://github.com/org/repo.git"), "https://github.com/org/repo");
    assert.strictEqual(toBrowsableUrl("https://github.com/org/repo"), "https://github.com/org/repo");
    assert.strictEqual(toBrowsableUrl("http://git.local:8080/team/repo.git/"), "http://git.local:8080/team/repo");
  });

  test("credentials in https remotes are stripped", () => {
    assert.strictEqual(toBrowsableUrl("https://user:s3cret@github.com/org/repo.git"), "https://github.com/org/repo");
    assert.strictEqual(toBrowsableUrl("https://ghp_TOKEN@github.com/org/repo"), "https://github.com/org/repo");
    assert.strictEqual(toBrowsableUrl("https://oauth2:glpat-x@gitlab.com/g/sub/repo.git"), "https://gitlab.com/g/sub/repo");
  });

  test("scp-like ssh remotes become https", () => {
    assert.strictEqual(toBrowsableUrl("git@github.com:org/repo.git"), "https://github.com/org/repo");
    assert.strictEqual(toBrowsableUrl("gitlab.com:group/sub/repo"), "https://gitlab.com/group/sub/repo");
  });

  test("ssh:// and git:// remotes become https without the ssh port", () => {
    assert.strictEqual(toBrowsableUrl("ssh://git@github.com:22/org/repo.git"), "https://github.com/org/repo");
    assert.strictEqual(toBrowsableUrl("git+ssh://git@host.example/org/repo"), "https://host.example/org/repo");
    assert.strictEqual(toBrowsableUrl("git://host.example/org/repo.git"), "https://host.example/org/repo");
  });

  test("query and fragment are dropped", () => {
    assert.strictEqual(toBrowsableUrl("https://h.example/org/repo.git?x=1#frag"), "https://h.example/org/repo");
  });

  test("dangerous or non-web schemes are rejected", () => {
    for (const bad of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "vscode://some.ext/handler?x=1",
      "ext::sh -c touch% /tmp/pwned",
      "data:text/html,<script>",
      "/local/path/repo.git",
      "../relative/repo",
      "C:\\repos\\thing.git",
      "",
      "   ",
    ]) {
      assert.strictEqual(toBrowsableUrl(bad), undefined, bad);
    }
    assert.strictEqual(toBrowsableUrl(undefined), undefined);
  });

  test("host-only or empty-path remotes are rejected", () => {
    assert.strictEqual(toBrowsableUrl("https://github.com/"), undefined);
    assert.strictEqual(toBrowsableUrl("git@github.com:.git"), undefined);
  });
});

describe("stripCredentials", () => {
  test("removes http(s) userinfo entirely", () => {
    assert.strictEqual(stripCredentials("https://user:pw@github.com/org/repo.git"), "https://github.com/org/repo.git");
    assert.strictEqual(stripCredentials("https://TOKEN@github.com/org/repo.git"), "https://github.com/org/repo.git");
  });

  test("keeps ssh username but drops password", () => {
    assert.strictEqual(stripCredentials("ssh://git:pw@host/org/repo.git"), "ssh://git@host/org/repo.git");
    assert.strictEqual(stripCredentials("ssh://git@host/org/repo.git"), "ssh://git@host/org/repo.git");
  });

  test("scp-like and clean URLs are unchanged", () => {
    assert.strictEqual(stripCredentials("git@github.com:org/repo.git"), "git@github.com:org/repo.git");
    assert.strictEqual(stripCredentials("https://github.com/org/repo.git"), "https://github.com/org/repo.git");
  });
});
