import json, sys
from gql import gql

ACC = "f670a698e17bf160c8e4679823e68916"
DB = "746c6e3d-782e-443a-82d6-28ca93a16294"
GEQ = "2026-10-29T00:00:00Z"
LT = "2026-11-05T00:00:00Z"

Q = {
    "workers": f'''query {{ viewer {{ accounts(filter: {{ accountTag: "{ACC}" }}) {{
      workersInvocationsAdaptive(limit: 10000, filter: {{ scriptName: "0509", datetime_geq: "{GEQ}", datetime_lt: "{LT}" }}, orderBy: [date_ASC]) {{
        dimensions {{ date isPreview usageModel }}
        sum {{ requests errors cpuTimeUs }}
      }}
    }} }} }}''',
    "d1": f'''query {{ viewer {{ accounts(filter: {{ accountTag: "{ACC}" }}) {{
      d1AnalyticsAdaptiveGroups(limit: 10000, filter: {{ databaseId: "{DB}", datetime_geq: "{GEQ}", datetime_lt: "{LT}" }}, orderBy: [date_ASC]) {{
        dimensions {{ date }}
        sum {{ rowsRead rowsWritten }}
      }}
    }} }} }}''',
    "r2ops": f'''query {{ viewer {{ accounts(filter: {{ accountTag: "{ACC}" }}) {{
      r2OperationsAdaptiveGroups(limit: 10000, filter: {{ datetime_geq: "{GEQ}", datetime_lt: "{LT}" }}) {{
        dimensions {{ bucketName actionType date }}
        sum {{ requests }}
      }}
    }} }} }}''',
    "r2storage": f'''query {{ viewer {{ accounts(filter: {{ accountTag: "{ACC}" }}) {{
      r2StorageAdaptiveGroups(limit: 10000, filter: {{ datetime_geq: "{GEQ}", datetime_lt: "{LT}" }}) {{
        dimensions {{ bucketName date }}
        max {{ payloadSize metadataSize objectCount }}
      }}
    }} }} }}''',
    "workflows": f'''query {{ viewer {{ accounts(filter: {{ accountTag: "{ACC}" }}) {{
      workflowsAdaptiveGroups(limit: 10000, filter: {{ datetime_geq: "{GEQ}", datetime_lt: "{LT}" }}) {{
        dimensions {{ workflowName date }}
        sum {{ stepCount }}
      }}
    }} }} }}''',
    "browser": f'''query {{ viewer {{ accounts(filter: {{ accountTag: "{ACC}" }}) {{
      browserRenderingBrowserTimeUsageAdaptiveGroups(limit: 10000, filter: {{ datetime_geq: "{GEQ}", datetime_lt: "{LT}" }}, orderBy: [date_ASC]) {{
        dimensions {{ date }}
        sum {{ totalSessionDurationMs }}
      }}
    }} }} }}''',
    "browserevents": f'''query {{ viewer {{ accounts(filter: {{ accountTag: "{ACC}" }}) {{
      browserRenderingEventsAdaptiveGroups(limit: 10000, filter: {{ datetime_geq: "{GEQ}", datetime_lt: "{LT}" }}) {{
        dimensions {{ date scriptName }}
        sum {{ events }}
      }}
    }} }} }}''',
    "queues": f'''query {{ viewer {{ accounts(filter: {{ accountTag: "{ACC}" }}) {{
      queueMessageOperationsAdaptiveGroups(limit: 10000, filter: {{ datetime_geq: "{GEQ}", datetime_lt: "{LT}" }}) {{
        dimensions {{ queueName date }}
        sum {{ billableOperations }}
      }}
    }} }} }}''',
}

out = {}
for name, q in Q.items():
    try:
        out[name] = gql(q)
    except SystemExit:
        out[name] = "QUERY FAILED"
    except Exception as e:
        out[name] = f"EXCEPTION {e}"
    print(name, "->", "ok" if not isinstance(out[name], str) else out[name], file=sys.stderr)

json.dump(out, open("week.json", "w"), indent=1)
