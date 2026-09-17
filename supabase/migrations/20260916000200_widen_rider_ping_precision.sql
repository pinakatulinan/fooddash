-- ============================================================================
-- 0014  Fix: record_rider_ping 400s on real-world geolocation readings
-- ----------------------------------------------------------------------------
-- rider_pings.accuracy_m was numeric(6,2) (max 9999.99) and speed_kph was
-- numeric(5,2) (max 999.99). Real browser Geolocation readings blow past
-- both routinely - a laptop with no GPS chip falls back to WiFi/IP-based
-- positioning and commonly reports accuracy in the tens of thousands of
-- metres, and GPS speed readings spike from multipath/jitter right after
-- acquiring a fix. Either one overflowing aborted the whole insert - lat/lng
-- included - so a single noisy optional field was silently blocking the
-- position update that is the entire point of the call.
--
-- Widened rather than clamped away: keeping the real (if noisy) value is
-- more honest than discarding it, and there is no reasonable value a real
-- device can report that will not fit in either column now.
-- ----------------------------------------------------------------------------

alter table public.rider_pings
  alter column speed_kph type numeric(7, 2),
  alter column accuracy_m type numeric(9, 2);
