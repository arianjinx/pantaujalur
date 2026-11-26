import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { Place } from "#/domain/types";
import type { PlaceField } from "#/flow/route-flow-machine";
import {
  placeSuggestions,
  QUICK_NAMES,
  savedPlaceAt,
  savePlace,
  shortLabel,
  updatePlaces,
  usePlaces,
} from "#/places/places-store";
import { placesQuery, pointLabelQuery } from "#/queries";

const SEARCH_DEBOUNCE_MS = 450;
const MIN_SEARCH_LENGTH = 3;

type PlaceInputProps = {
  field: PlaceField;
  title: string;
  place: Place | null;

  status?: ReactNode;
  picking: boolean;
  extraAction?: ReactNode;
  onChoose: (place: Place) => void;
  onClear: () => void;
  onPickOnMap: () => void;
  onCancelPick: () => void;
};

export function PlaceInput(props: PlaceInputProps) {
  const { field, title, place, status, picking, extraAction } = props;
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const places = usePlaces();
  const suggestions = focused ? placeSuggestions(places, text) : [];
  const savedName = place ? savedPlaceAt(places, place)?.name : undefined;
  const query = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS);
  const results = useQuery({
    ...placesQuery(query),
    enabled: query.length >= MIN_SEARCH_LENGTH,
  });
  const showResults =
    text.trim().length >= MIN_SEARCH_LENGTH && query === text.trim();

  const choose = (chosen: Place) => {
    setText("");
    inputRef.current?.blur();
    props.onChoose(chosen);
  };

  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          {title}
        </h2>
        <div className="flex gap-1">
          {extraAction}
          <button
            type="button"
            className={picking ? "btn btn-active" : "btn"}
            onClick={picking ? props.onCancelPick : props.onPickOnMap}
          >
            {picking ? "Cancel pick" : "Pick on map"}
          </button>
        </div>
      </div>

      {place ? (
        <div className="relative flex items-start justify-between gap-2 rounded-md bg-slate-100 px-3 py-2">
          <PlaceLabel place={place} savedName={savedName} />
          <div className="flex shrink-0 items-center gap-3">
            <SavePlace field={field} place={place} savedName={savedName} />
            <button
              type="button"
              className="text-slate-400 hover:text-slate-700"
              aria-label={`Clear ${field}`}
              onClick={props.onClear}
            >
              ✕
            </button>
          </div>
        </div>
      ) : (
        status && (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {status}
          </div>
        )
      )}

      {picking && (
        <p className="text-sm text-blue-700">
          Click the map to set the {field}.
        </p>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
          placeholder={`Search ${field}…`}
          aria-label={`Search ${field}`}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        {(suggestions.length > 0 || showResults) && (
          <div
            className="absolute inset-x-0 top-full z-[1000] mt-1 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"

            onMouseDown={(e) => e.preventDefault()}
          >
            {suggestions.length > 0 && (
              <ul
                role="listbox"
                aria-label={`${field} suggestions`}
                className={showResults ? "border-b border-slate-200" : ""}
              >
                {suggestions.map(({ place: suggested, name }) => (
                  <li
                    key={`${suggested.position.lat},${suggested.position.lng}`}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100"
                      onClick={() => choose(suggested)}
                    >
                      <span aria-hidden className="text-slate-400">
                        {name ? "★" : "↺"}
                      </span>
                      <span className="min-w-0 truncate">
                        {name ? (
                          <>
                            <span className="font-medium">{name}</span>{" "}
                            <span className="text-slate-500">
                              {shortLabel(suggested.label)}
                            </span>
                          </>
                        ) : (
                          suggested.label
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showResults && (
              <>
                {results.isFetching && (
                  <p className="px-3 py-2 text-sm text-slate-500">Searching…</p>
                )}
                {results.isError && (
                  <p className="px-3 py-2 text-sm text-red-600">
                    Search failed. Try again.
                  </p>
                )}
                {results.data?.length === 0 && (
                  <p className="px-3 py-2 text-sm text-slate-500">
                    No places found.
                  </p>
                )}
                <ul role="listbox" aria-label={`${field} results`}>
                  {results.data?.map((result) => (
                    <li key={`${result.position.lat},${result.position.lng}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
                        onClick={() => choose(result)}
                      >
                        {result.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function PlaceLabel({
  place,
  savedName,
}: {
  place: Place;
  savedName: string | undefined;
}) {
  const described = useQuery({
    ...pointLabelQuery(place.position),
    enabled: place.source !== "search",
  });
  const sourceNote = { gps: "My location", map: "Picked on map", search: null }[
    place.source
  ];
  return (
    <div className="min-w-0 text-sm">
      {savedName && (
        <p className="font-semibold text-blue-700" data-testid="saved-name">
          {savedName}
        </p>
      )}
      <p
        className={
          savedName
            ? "truncate text-xs text-slate-600"
            : "truncate font-medium text-slate-900"
        }
        data-testid="place-label"
      >
        {described.data ?? place.label}
      </p>
      {sourceNote && <p className="text-xs text-slate-500">{sourceNote}</p>}
    </div>
  );
}

function SavePlace({
  field,
  place,
  savedName,
}: {
  field: PlaceField;
  place: Place;
  savedName: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const save = (chosen: string) => {
    updatePlaces((s) => savePlace(s, chosen, place, crypto.randomUUID()));
    setName("");
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className={
          savedName
            ? "text-lg leading-none text-amber-500"
            : "text-lg leading-none text-slate-400 hover:text-amber-500"
        }
        aria-label={savedName ? `Rename ${savedName}` : `Save ${field} as…`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {savedName ? "★" : "☆"}
      </button>
      {open && (
        <form
          aria-label={`Save ${field}`}
          className="absolute inset-x-0 top-full z-[1001] mt-1 space-y-2 rounded-md border border-slate-200 bg-white p-3 shadow-lg"
          onSubmit={(e) => {
            e.preventDefault();
            save(name);
          }}
        >
          <p className="text-xs font-semibold text-slate-500">Save as</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_NAMES.map((quick) => (
              <button
                key={quick}
                type="button"
                className="btn px-3 py-1.5 text-sm"
                onClick={() => save(quick)}
              >
                {quick}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Other name, e.g. Gym"
              aria-label={`Name for ${field}`}
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="btn px-3 py-1.5 text-sm"
              disabled={!name.trim()}
            >
              Save
            </button>
            <button
              type="button"
              className="btn px-3 py-1.5 text-sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </>
  );
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
