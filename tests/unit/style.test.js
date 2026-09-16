/**
 * 样式回归测试：这里卡的都是「曾经真实出过 bug」的 CSS 规则。
 * DOM stub 不执行 CSS，所以只能用源码级断言兜住。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
const css = fs.readFileSync(path.join(ROOT, 'assets/css/style.css'), 'utf8');

test('[hidden] 必须能压过任何 class 的 display（否则弹窗/遮罩关不掉）', () => {
  const rule = css.match(/\[hidden\]\s*\{[^}]*\}/);
  assert.ok(rule, 'style.css 应声明 [hidden] 规则');
  assert.match(rule[0], /display:\s*none/, '[hidden] 必须设置 display: none');
  assert.match(rule[0], /!important/, '[hidden] 需要 !important 才能压过 .modal{display:flex} 等规则');
});
