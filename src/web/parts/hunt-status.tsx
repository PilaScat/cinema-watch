import { copy } from "../../copy.js";
import { formatDay } from "../../format.js";
import type { Hunt, HuntState } from "../../model.js";
import { ActionForm, Badge, Button, Card, LinkButton } from "../components.js";

const ui = copy.ui.hunts;
const common = copy.ui.common;


export function StatusCards(props: { hunt: Hunt; state: HuntState | undefined; theatreNames: Record<string, string> }) {
  const { hunt } = props;
  const showings = Object.values(props.state?.showings ?? {}).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const pending = props.state?.pendingMovieSlugs ?? [];
  return (
    <>
      <Card
        title={ui.sections.status}
        actions={
          <>
            <ActionForm action={`/hunts/${hunt.id}/send`}>
              <Button label={ui.actions.send} icon="send" size="sm" variant="outline" />
            </ActionForm>
            {hunt.archivedAt === null ? (
              <ActionForm action={`/hunts/${hunt.id}/bought`}>
                <Button label={ui.actions.bought} icon="ticket" size="sm" variant="outline" confirm={ui.actions.confirmBought} />
              </ActionForm>
            ) : (
              <ActionForm action={`/hunts/${hunt.id}/restore`}>
                <Button label={ui.actions.restore} icon="refreshCw" size="sm" variant="outline" />
              </ActionForm>
            )}
            <ActionForm action={`/hunts/${hunt.id}/delete`}>
              <Button label={ui.actions.deleteHunt} icon="trash2" size="sm" variant="danger" confirm={common.actions.confirmDelete} />
            </ActionForm>
          </>
        }
      >
        {showings.length === 0 ? (
          <p class="text-sm text-muted">{ui.empty.showings}</p>
        ) : (
          <ul class="flex flex-col divide-y divide-border">
            {showings.map((showing) => {
              const query = new URLSearchParams({ hunt: hunt.id, movie: showing.movieSlug, theatre: showing.theatreSlug });
              const free = showing.seats?.freeInZone;
              return (
                <li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div class="min-w-0">
                    <span class="font-semibold">{`${formatDay(showing.day)} ${showing.time}`}</span>
                    <span class="text-muted">{` · ${props.theatreNames[showing.theatreSlug] ?? showing.theatreSlug} · ${showing.screenName ?? showing.room}`}</span>
                  </div>
                  <div class="flex items-center gap-3">
                    {free === undefined ? (
                      <Badge tone="muted">{ui.showing.unknown}</Badge>
                    ) : (
                      <Badge tone={showing.seats?.ok ? "gold" : "neutral"}>{ui.showing.free(free)}</Badge>
                    )}
                    <a href={`/showings/${showing.key}?${query.toString()}`} class="font-semibold text-primary hover:underline">
                      {ui.showing.open}
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {pending.length > 0 ? (
        <Card title={ui.sections.pending}>
          <ul class="flex flex-col divide-y divide-border">
            {pending.map((slug) => (
              <li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span class="min-w-0 font-semibold">{slug}</span>
                <ActionForm action={`/hunts/${hunt.id}/confirm`}>
                  <input type="hidden" name="slug" value={slug} />
                  <Button label={ui.actions.confirm} icon="check" size="sm" variant="primary" />
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <HallZonesCard hunt={hunt} state={props.state} />
    </>
  );
}

function HallZonesCard(props: { hunt: Hunt; state: HuntState | undefined }) {
  const { hunt } = props;
  const rooms = new Map<string, { room: string; showingKey: string }>();
  for (const showing of Object.values(props.state?.showings ?? {})) {
    const key = showing.hallKey;
    if (key !== null && !rooms.has(key)) rooms.set(key, { room: showing.screenName ?? showing.room, showingKey: showing.key });
  }
  const zones = Object.entries(hunt.hallZones);
  const toReconfirm = props.state?.hallsToReconfirm ?? [];
  return (
    <Card title={ui.sections.halls}>
      {zones.length === 0 ? <p class="text-sm text-muted">{ui.empty.halls}</p> : null}
      <ul class="flex flex-col divide-y divide-border">
        {zones.map(([key, zone]) => (
          <li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span class="min-w-0">
              <span class="font-semibold">{rooms.get(key)?.room ?? key}</span>
              <span class="text-muted">{` · ${ui.zonePage.zoneSummary(zone.rows.join(", "), zone.seatFrom, zone.seatTo)}`}</span>
            </span>
            {toReconfirm.includes(key) ? <Badge tone="danger">{ui.hallChanged}</Badge> : null}
            <ActionForm action={`/hunts/${hunt.id}/zones/${key}/delete`}>
              <Button label={ui.actions.removeZone} icon="trash2" size="sm" variant="danger" />
            </ActionForm>
          </li>
        ))}
      </ul>
      {rooms.size > 0 ? (
        <ul class="mt-3 flex flex-col gap-2">
          {[...rooms.values()].map((room) => (
            <li class="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span class="min-w-0">{room.room}</span>
              <LinkButton
                href={`/hunts/${hunt.id}/zone?performance=${room.showingKey}`}
                label={ui.actions.setZone}
                icon="armchair"
                size="sm"
                variant="outline"
              />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
