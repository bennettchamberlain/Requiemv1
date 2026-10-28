# Batch of raw positions from the Flutter location stream.
# variables: $points (json array of {at, lat, lng, accuracy_m?, speed_mps?, source?, device_id?})
with
  rows := json_array_unpack(<json>$points)
for r in rows union (
  insert Position {
    owner := assert_exists(global current_person),
    at := <datetime>r['at'],
    lat := <float64>r['lat'],
    lng := <float64>r['lng'],
    accuracy_m := <optional float32>json_get(r, 'accuracy_m'),
    speed_mps := <optional float32>json_get(r, 'speed_mps'),
    source := <optional str>json_get(r, 'source'),
    device_id := <optional str>json_get(r, 'device_id'),
  }
);
