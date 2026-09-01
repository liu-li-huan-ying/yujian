/** 取路径末段文件名并去掉 .md/.markdown 扩展名；拿不到时回退 fallback */
export function baseName(path: string, fallback = 'document'): string {
  return (path.split(/[\\/]/).pop() ?? fallback).replace(/\.(md|markdown)$/i, '')
}
