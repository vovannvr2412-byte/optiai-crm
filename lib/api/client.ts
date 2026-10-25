export async function readApiJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body.trim()) {
    throw new Error(`CRM API вернул пустой ответ (HTTP ${response.status}). Повторите действие после обновления страницы.`);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`CRM API вернул некорректный ответ (HTTP ${response.status}). Проверьте журнал Vercel.`);
  }
}

export async function readApiJsonOrNull<T>(response: Response): Promise<T | null> {
  try {
    return await readApiJson<T>(response);
  } catch {
    return null;
  }
}
