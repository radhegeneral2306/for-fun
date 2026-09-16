"""One-off inspection tool: dumps the shape of a real Google Timeline export
so backend/parser.py's field mapping can be built against actual data
instead of guesses. Run: python scripts/inspect_export.py <path-to-json>
"""
import json
import sys
from collections import Counter


def walk_keys(d, prefix, into):
    if isinstance(d, dict):
        for k, v in d.items():
            path = f"{prefix}.{k}" if prefix else k
            into.add(path)
            walk_keys(v, path, into)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if not path:
        print("Usage: python scripts/inspect_export.py <path-to-json>")
        sys.exit(1)

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    print("Top-level keys:", list(data.keys()))

    segments = data.get("semanticSegments", [])
    print(f"\nsemanticSegments count: {len(segments)}")

    visit_keys, activity_keys, other_keys = set(), set(), set()
    activity_types = Counter()
    semantic_types = Counter()
    tz_present = 0
    place_name_fields = set()
    kind_counts = Counter()

    for seg in segments:
        top_keys = set(seg.keys()) - {"visit", "activity", "timelinePath"}
        other_keys |= top_keys
        if "startTimeTimezoneUtcOffsetMinutes" in seg:
            tz_present += 1

        if "visit" in seg:
            kind_counts["visit"] += 1
            walk_keys(seg["visit"], "visit", visit_keys)
            tc = seg["visit"].get("topCandidate", {})
            semantic_types[tc.get("semanticType")] += 1
            for k in tc.keys():
                if "name" in k.lower() or "address" in k.lower() or "label" in k.lower():
                    place_name_fields.add(f"visit.topCandidate.{k}")
        elif "activity" in seg:
            kind_counts["activity"] += 1
            walk_keys(seg["activity"], "activity", activity_keys)
            tc = seg["activity"].get("topCandidate", {})
            activity_types[tc.get("type")] += 1
        else:
            kind_counts["neither_visit_nor_activity"] += 1

    print(f"\nSegment kind counts: {dict(kind_counts)}")
    print(f"Segments with startTimeTimezoneUtcOffsetMinutes: {tz_present}/{len(segments)}")

    print("\nOther top-level segment fields seen:", sorted(other_keys))

    print("\nAll fields seen under 'visit':")
    for k in sorted(visit_keys):
        print(" ", k)

    print("\nAll fields seen under 'activity':")
    for k in sorted(activity_keys):
        print(" ", k)

    print("\nDistinct visit.topCandidate.semanticType values:")
    for k, c in semantic_types.most_common():
        print(f"  {k}: {c}")

    print("\nDistinct activity.topCandidate.type values (transport modes):")
    for k, c in activity_types.most_common():
        print(f"  {k}: {c}")

    print("\nPossible human-readable place-name fields found:", place_name_fields or "none found")

    # Print one full example of each kind, pretty-printed, for manual review.
    for kind in ("visit", "activity"):
        for seg in segments:
            if kind in seg:
                print(f"\n--- Example '{kind}' segment ---")
                print(json.dumps(seg, indent=2)[:3000])
                break


if __name__ == "__main__":
    main()
