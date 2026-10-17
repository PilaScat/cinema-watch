import { copy } from "./copy.js";
import { formatDay } from "./format.js";
import { renderHallSvg } from "./hall-svg.js";
import type { OutgoingMessage } from "./model.js";
import { svgToPng, TELEGRAM_PHOTO_WIDTH } from "./png.js";
import type { HuntObservation } from "./runner.js";

export function photoKeys(messages: OutgoingMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.kind === "photo") return [message.showingKey];
    if (message.kind === "album") return message.items.map((item) => item.showingKey);
    return [];
  });
}

export function renderPhotos(keys: string[], observation: HuntObservation, theatreNames: Record<string, string>): Map<string, Uint8Array> {
  const photos = new Map<string, Uint8Array>();
  for (const key of keys) {
    const detail = observation.details.get(key);
    const observed = observation.round.showings.find((item) => item.showing.key === key);
    if (!detail || !observed) continue;
    const { showing } = observed;
    const svg = renderHallSvg(detail.hall, detail.occupancy, detail.analysis, detail.rule, {
      title: showing.movie.title,
      subtitle: copy.hall.subtitle(theatreNames[showing.theatreSlug] ?? showing.theatreSlug, showing.room, formatDay(showing.day), showing.time),
      labels: copy.hall.labels,
      theme: "dark",
    });
    photos.set(key, svgToPng(svg, { width: TELEGRAM_PHOTO_WIDTH }));
  }
  return photos;
}
