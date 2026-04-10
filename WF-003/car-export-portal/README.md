# 姹囬┌鏅鸿仈浜屾墜杞﹀嚭娴风礌鏉愭彁浜ら〉

杩欏椤甸潰鍜屾湰鍦拌浆鍙戞湇鍔￠兘鍦?`car-export-portal` 鐩綍鍐呫€?
涓昏鏂囦欢锛?
- [index.html](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/index.html)
- [style.css](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/style.css)
- [script.js](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/script.js)
- [server.js](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/server.js)
- [ui-assets](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/ui-assets)
- [ASSET_MAP.md](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/ASSET_MAP.md)
- [asset-map.json](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/asset-map.json)

## 鍚姩鏂瑰紡

杩涘叆鐩綍锛?
```powershell
cd C:\Users\27256\Documents\Codex\椤圭洰娴嬭瘯\car-export-portal
```

閰嶇疆 N8N webhook 鍦板潃锛?
```powershell
$env:CAR_EXPORT_WEBHOOK_URL="浣犵殑 n8n webhook 鍦板潃"
```

濡傛灉涓嶆樉寮忚缃幆澧冨彉閲忥紝鏈嶅姟榛樿杞彂鍒版寮忕増鍦板潃锛?
```text
https://n8n.deepsix.store/webhook/bda7b6ac-10b6-4467-b6fd-83dd68c0bbd9
```

閰嶇疆宸ヤ綔娴?API 鍩哄湴鍧€锛?
```powershell
$env:WORKFLOW_API_BASE="https://浣犵殑宸ヤ綔娴佸悗绔煙鍚?
```

渚嬪锛?
```text
https://n8n.deepsix.store
```

濡傛灉浣犵殑 WF-003 鍚庣閮ㄧ讲鍦?n8n锛岃繕鍙互鏄惧紡閰嶇疆鎻愪氦 webhook 璺緞锛?
```powershell
$env:WORKFLOW_SUBMIT_PATH="/webhook/wf003-kie-submit-123"
```

鍓嶇鎻愪氦 `POST /api/v1/workflows/WF-003/json-execute` 鏃讹紝`server.js` 浼氭妸杩欐潯璺緞閲嶅啓骞惰浆鍙戝埌锛?
```text
{WORKFLOW_API_BASE}{WORKFLOW_SUBMIT_PATH}
```

鎸夊綋鍓嶄粨搴撻噷鐨?n8n 瀵煎嚭鏂囦欢锛岄粯璁や細杞彂鍒帮細

```text
https://n8n.deepsix.store/webhook/wf003-kie-submit-123
```

濡傛灉浣犲凡缁忕洿鎺ラ厤缃簡瀹屾暣鐨?n8n 鎻愪氦鍦板潃锛屼篃鍙互鍙缃細

```powershell
$env:WF_003_WEBHOOK_URL="https://n8n.deepsix.store/webhook/wf003-kie-submit-123"
```

褰撳墠鐗堟湰浼氫紭鍏堜娇鐢?`WF_003_WEBHOOK_URL`銆傝繖閫傚悎浣犵殑绾夸笂鐜宸茬粡鐩存帴缁欏嚭瀹屾暣 webhook 鍦板潃鐨勬儏鍐点€?
鍏堝畨瑁呬緷璧栵細

```powershell
npm install
```

鍚姩锛?
```powershell
node server.js
```

榛樿璁块棶鍦板潃锛?
```text
http://localhost:3001
```

灞€鍩熺綉璁块棶锛?
```text
http://浣犵殑灞€鍩熺綉IP:3001
```

## 褰撳墠鍓嶇瀛楁

鍓嶇鎻愪氦鍒版湰鍦版湇鍔?`/api/car-export-submit` 鐨勫瓧娈垫槸锛?
- `car_name`
- `exterior_images`
- `interior_images`
- `logo`

璇存槑锛?
- `exterior_images` 鏄噸澶嶆彁浜ょ殑澶氭枃浠跺瓧娈?- `interior_images` 鏄噸澶嶆彁浜ょ殑澶氭枃浠跺瓧娈?
## 鏈湴鏈嶅姟杞彂瑙勫垯

[server.js](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/server.js) 浼氳嚜鍔ㄦ妸鍓嶇瀛楁杞崲鍚庡啀杞彂缁?N8N锛?
- `exterior_images` -> `exterior_1`, `exterior_2`, `exterior_3` ...
- `interior_images` -> `interior_1`, `interior_2`, `interior_3` ...
- `car_name` 鍘熸牱杞彂
- `logo` 鍘熸牱杞彂

杩欐牱鍋氱殑鐩殑锛屾槸璁╁墠绔敮鎸佷笉闄愭暟閲忎笂浼狅紝鍚屾椂鍏煎褰撳墠 N8N 宸ヤ綔娴佹寜缂栧彿璇嗗埆鍥剧墖瀛楁鐨勯€昏緫銆?
## 鏈嶅姟鍣ㄥ浘鐗?URL

褰撳墠鏈嶅姟浼氬厛鎶婁笂浼犲浘鐗囦繚瀛樺埌鏈嶅姟鍣ㄦ湰鍦扮洰褰曪細

- `car-export-portal/uploads`

鐒跺悗杩斿洖浣犺嚜宸辨湇鍔″櫒鐨勫浘鐗囧湴鍧€銆?
杩斿洖缁撴瀯閲屼富瑕佺湅锛?
- `uploaded.exteriorImages`
- `uploaded.interiorImages`
- `uploaded.logo`
- `uploaded.allFiles`

姣忎竴椤归兘浼氬甫锛?
- `fieldName`
- `originalName`
- `savedName`
- `url`

渚嬪锛?
```json
{
  "ok": true,
  "uploaded": {
    "exteriorImages": [
      {
        "fieldName": "exterior_images",
        "originalName": "car-1.jpg",
        "savedName": "1710000000000-ab12cd-car-1.jpg",
        "url": "http://your-domain/uploads/1710000000000-ab12cd-car-1.jpg"
      }
    ]
  }
}
```

鍓嶇鎻愪氦鎴愬姛鍚庯紝娴忚鍣ㄦ帶鍒跺彴鍙互鐩存帴鐪嬶細

- `window.lastUploadResult`

## 褰撳墠椤甸潰浜や簰

- 杈撳叆杞﹀悕
- 閫夋嫨姹借溅涓诲浘
- 閫夋嫨姹借溅鍐呴グ鍥?- 妫€鏌ョ缉鐣ュ浘
- 鐐瑰嚮鈥滄彁浜よ繍琛屸€?
椤甸潰鏁堟灉锛?
- 閫夊浘鍚庢樉绀虹缉鐣ュ浘
- 鐐瑰嚮缂╃暐鍥炬煡鐪嬪師鍥?- 鐐瑰嚮鍙充笂瑙掑弶鍙峰垹闄ゅ浘鐗?- 鎻愪氦鏃剁缉鐣ュ浘鏄剧ず杞湀鐘舵€?- 鎴愬姛鍚庡脊鍑衡€滃凡缁忔彁浜よ繍琛屸€?- 纭鍚庤嚜鍔ㄦ竻绌猴紝鏂逛究涓嬩竴杞彁浜?
## Logo 鍜?UI 绱犳潗

Logo 鏂囦欢锛?
- [logo.png](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/logo/logo.png)

UI 鍙浛鎹㈢礌鏉愶細

- [scene-grid.svg](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/ui-assets/scene-grid.svg)
- [scene-wave.svg](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/ui-assets/scene-wave.svg)
- [upload-plus.svg](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/ui-assets/upload-plus.svg)

缁欏紑鍙戝悓浜嬪悓姝ョ礌鏉愪綅缃椂锛岀洿鎺ョ湅锛?
- [ASSET_MAP.md](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/ASSET_MAP.md)
- [asset-map.json](C:/Users/27256/Documents/Codex/椤圭洰娴嬭瘯/car-export-portal/asset-map.json)

