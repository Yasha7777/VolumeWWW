"""Publish a reviewed reconstruction without changing scans or analysis records.

Requires the site's existing SUPABASE_URL and SUPABASE_SERVICE_KEY environment.
It verifies the source fingerprint and archives versions before an explicit replacement.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.request
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app.reconstruction import ARTIFACT_NAME, validate_reconstruction


def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('artifact', type=Path)
    p.add_argument('--replace-reviewed', action='store_true', help='Archive and replace an earlier reviewed result for exactly the same source')
    args = p.parse_args()
    payload = args.artifact.read_bytes()
    data = json.loads(payload)
    scan_id = data['reconstruction']['scan_id']
    validate_reconstruction(data, scan_id)
    base = os.environ['SUPABASE_URL'].rstrip('/')
    key = os.environ['SUPABASE_SERVICE_KEY']
    headers = {'apikey': key, 'Authorization': 'Bearer '+key}

    def get(path, missing_ok=False):
        for attempt in range(4):
            try:
                return json.load(urllib.request.urlopen(urllib.request.Request(base+path, headers=headers), timeout=40))
            except urllib.error.HTTPError as error:
                if missing_ok and error.code in (400,404):
                    try: detail=json.loads(error.read())
                    except ValueError: detail={}
                    if error.code == 404 or str(detail.get('statusCode')) == '404' or detail.get('error') == 'not_found':
                        return None
                raise
            except Exception:
                if attempt == 3:
                    raise

    rows = get('/rest/v1/scans?select=id,storage_prefix,status,frame_count&id=eq.'+scan_id)
    if len(rows) != 1 or rows[0]['status'] != 'ready':
        raise ValueError('Scan is missing or incomplete')
    row = rows[0]
    if row['frame_count'] != data['reconstruction']['photo_count']:
        raise ValueError('Photo count changed')
    prefix = row['storage_prefix']
    source = get('/storage/v1/object/colmap/'+prefix+'/scan.json')
    if fingerprint(source) != data['reconstruction']['source_sha256']:
        raise ValueError('Source scan changed; reconstruction is stale')
    path = '/storage/v1/object/colmap/'+prefix+'/'+ARTIFACT_NAME
    current = get(path, missing_ok=True)
    if current is not None:
        validate_reconstruction(current, scan_id)
        if not args.replace_reviewed:
            raise ValueError('Reviewed artifact already exists; replacement must be explicit')
        if current['reconstruction']['source_sha256'] != data['reconstruction']['source_sha256']:
            raise ValueError('Cannot replace a reconstruction of a different source')

    def upload(target, body, upsert=False):
        req = urllib.request.Request(base+target, data=body, method='POST',
            headers={**headers, 'Content-Type':'application/json', 'x-upsert':str(upsert).lower(), 'Cache-Control':'no-cache'})
        with urllib.request.urlopen(req, timeout=60) as response:
            response.read()

    # Preserve both old and new reviewed versions before switching the live file.
    for version in ([current] if current is not None else []) + [data]:
        body=json.dumps(version,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
        digest=hashlib.sha256(body).hexdigest()
        history='/storage/v1/object/colmap/'+prefix+'/reconstructions/'+digest+'.json'
        existing=get(history,missing_ok=True)
        if existing is None:
            upload(history,body)
        elif existing != version:
            raise ValueError('Unexpected immutable history contents')
    upload(path,payload,upsert=current is not None)
    check = validate_reconstruction(get(path), scan_id)
    if check != data:
        raise RuntimeError('Uploaded artifact did not round-trip')
    print(json.dumps({'scan_id': scan_id, 'volume_m3': check['surface']['volume'], 'verified': True}))


if __name__ == '__main__':
    main()
