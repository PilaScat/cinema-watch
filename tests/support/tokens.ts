export function fakeBotToken(botId: number, letter: string): string {
  return `${botId}:${letter.repeat(35)}`;
}
