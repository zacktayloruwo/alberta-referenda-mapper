# Visualizing the 2026 Alberta Referenda

An interactive map of poll-by-poll results from Alberta's 10 referendum questions of October 19, 2026.

**Live map:** https://zacktayloruwo.github.io/alberta-referenda-mapper/

Results and voting area boundaries are from [Elections Alberta](https://officialresults.elections.ab.ca/orEDResultsReferendum2026.cfm?EventId=202610). The map uses [Leaflet](https://leafletjs.com/), and [hyparquet](https://github.com/hyparam/hyparquet) reads the Parquet data files in the browser.

To run it locally:

```bash
python3 -m http.server 8765 --directory app
```

Created by Dr. Zack Taylor, Dept. of Political Science, University of Western Ontario.
