# Test fixtures

- `gladys-feature-table.json`: category/type couples, units and poll frequencies the Gladys core
  knows, extracted from its code (see its `source` field).
- `fritz/tr64desc.xml`, `fritz/igddesc.xml`, `fritz/devicehostlist.xml`: real TR-064 and UPnP IGD
  descriptions of a FRITZ!Box 7590 and a real host list, from the tests of
  [fritzconnection](https://github.com/kbr/fritzconnection) (MIT, Klaus Bremer). The UDN suffix
  (the MAC of the box), the IP addresses (192.0.2.0/24) and the MAC addresses of the hosts are
  replaced by invented ones.
- `fritz/soap-responses.json`: output arguments of the actions the integration calls, from the Home
  Assistant `fritz` test constants (`tests/components/fritz/const.py`, a FRITZ!Box 7530 AX,
  Apache-2.0) and fritzconnection's tests; serial number and addresses anonymized (external IP in
  203.0.113.0/24), guest Wi-Fi name and password invented.
- `fritz/phonebook.xml`: a phone book in the format AVM documents for `X_AVM-DE_OnTel`
  (`x_contactSCPD`), with invented contacts and numbers.
- `fritz/callmonitor.txt`: call monitor lines in the format shown by fritzconnection's
  documentation and parsed by Home Assistant's `fritzbox_callmonitor`, with invented numbers.
- `fritz/ssdp-results.json`: results of the core's SSDP scan (`scanNetwork('ssdp')`) in the shape of
  `networkDiscovery.scanSsdp.js` (Gladys 5.2.0); headers composed from the AVM format (`SERVER:
<name> UPnP/1.0 AVM <model> <FRITZ!OS>`, location of `tr64desc.xml`), not a capture.
