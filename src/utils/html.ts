/** XML/HTML 转义：覆盖 & < > " ' 五类特殊字符。
 *  &apos; 在 HTML5 与 XML 中均合法，故文本内容与属性值场景共用同一函数即可。 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
