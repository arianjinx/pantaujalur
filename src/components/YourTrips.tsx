import { useEffect, useState } from "react";

import type { Place } from "#/domain/types";
import {
  forgetTrip,
  removeSaved,
  renamePlace,
  shortLabel,
  tripName,
  updatePlaces,
  usePlaces,
} from "#/places/places-store";

/** One tap from a past trip to its route: "Home → Work". */
export function YourTrips({
  onChoose,
}: {
  onChoose: (origin: Place, destination: Place) => void;
}) {
  const places = usePlaces();
  const [managing, setManaging] = useState(false);
  if (places.recentTrips.length === 0 && places.saved.length === 0) return null;

  return (
    <section className="space-y-2" aria-label="Your trips">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Your trips
        </h2>
        {places.saved.length > 0 && (
          <button
            type="button"
            className="btn"
            onClick={() => setManaging(true)}
          >
            Manage places
          </button>
        )}
      </div>

      {places.recentTrips.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {places.recentTrips.map((trip) => {
            const name = tripName(places, trip);
            return (
              <li
                key={JSON.stringify([
                  trip.origin.position,
                  trip.destination.position,
                ])}
                className="flex items-center rounded-full border border-slate-300 bg-white text-sm"
              >
                <button
                  type="button"
                  className="rounded-l-full py-1.5 pr-1 pl-3 font-medium text-slate-800 hover:bg-slate-50"
                  onClick={() => onChoose(trip.origin, trip.destination)}
                >
                  {name}
                </button>
                <button
                  type="button"
                  className="rounded-r-full py-1.5 pr-3 pl-1.5 text-slate-400 hover:text-slate-700"
                  aria-label={`Forget ${name}`}
                  onClick={() => updatePlaces((s) => forgetTrip(s, trip))}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {managing && <ManagePlaces onClose={() => setManaging(false)} />}
    </section>
  );
}

function ManagePlaces({ onClose }: { onClose: () => void }) {
  const places = usePlaces();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/40 md:items-center md:p-3"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage places"
        className="max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-t-xl bg-white p-4 shadow-2xl md:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Manage places</h2>
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>

        {places.saved.length === 0 ? (
          <p className="text-sm text-slate-500">No saved places.</p>
        ) : (
          <ul className="space-y-2">
            {places.saved.map((saved) => (
              <li key={saved.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    key={saved.name}
                    defaultValue={saved.name}
                    aria-label={`Name for ${shortLabel(saved.place.label)}`}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-medium outline-none focus:border-blue-500"
                    onKeyDown={(e) =>
                      e.key === "Enter" && e.currentTarget.blur()
                    }
                    onBlur={(e) => {
                      const name = e.currentTarget.value.trim();
                      if (!name) e.currentTarget.value = saved.name;
                      else if (name !== saved.name)
                        updatePlaces((s) => renamePlace(s, saved.id, name));
                    }}
                  />
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {saved.place.label}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn self-start py-1.5"
                  aria-label={`Delete ${saved.name}`}
                  onClick={() => updatePlaces((s) => removeSaved(s, saved.id))}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-xs text-slate-500">
          Saved on this device only.
        </p>
      </div>
    </div>
  );
}
