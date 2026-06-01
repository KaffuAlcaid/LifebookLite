for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:5000/" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
exec microsoft-edge-stable --app="http://127.0.0.1:5000"
