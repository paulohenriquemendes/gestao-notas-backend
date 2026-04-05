/**
 * Gera logs estruturados em JSON para facilitar leitura e observabilidade.
 */
function escreverLog(level: "info" | "warn" | "error", mensagem: string, contexto?: unknown) {
  const payload = {
    level,
    mensagem,
    contexto: contexto ?? null,
    timestamp: new Date().toISOString(),
  };

  const serializado = JSON.stringify(payload);

  if (level === "error") {
    console.error(serializado);
    return;
  }

  console.log(serializado);
}

export const logger = {
  info: (mensagem: string, contexto?: unknown) => escreverLog("info", mensagem, contexto),
  warn: (mensagem: string, contexto?: unknown) => escreverLog("warn", mensagem, contexto),
  error: (mensagem: string, contexto?: unknown) => escreverLog("error", mensagem, contexto),
};
