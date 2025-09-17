fetch('./N03-21_44_210101.geojson')
  .then(response => {
    if (!response.ok) throw new Error('Network response was not ok');
    return response.json();
  })
  .then(geojson => {
    const feature = geojson.features[0];
    console.log(feature)
    // 1. ここで処理を書く
    document.getElementById("json").textContent = JSON.stringify(feature.geometry, null, 2);

    const pointList = feature.geometry.coordinates[0]; 
 
//ここから
    const features = geojson.features;
    const pointsList = features.map((feature)=>{
      return feature.geometry.coordinates[0];
    })
    const points = pointsList.flat(1);
    // 2. 最大・最小を求める
    const lons = points.map(p => p[0]);
    const lats = points.map(p => p[1]);
    //const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    //const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const min = function (ary){ return ary.reduce((a, b)=>Math.min(a,b))}
    const max = function (ary){ return ary.reduce((a, b)=>Math.max(a,b))}
    const minLon = min(lons), maxLon = max(lons);
    const minLat = min(lats), maxLat = max(lats);

    // 3. 描画するSVG/Canvasのサイズ
     const width = 200, height = (maxLat - minLat)/(maxLon - minLon)*200;
//    const width = 200;
//    const height = document.getElementById("profile").getAttribute("height") -0;
    // 4. 緯度経度→SVG座標変換関数
    const  toSvgCoord = ([lon, lat])=>{
      return [
        ((lon - minLon) / (maxLon - minLon)) * width,
      height - ((lat - minLat) / (maxLat - minLat)) * height
      ]
    };

     const pieces = pointsList.map((pList)=>{
      return pList.map((point, i)=>{
        const [long, lat] = toSvgCoord(point);
        const prefix = i < 1 ? "M" : "L"
        return prefix + long + " " + lat;
      }).join(" ")
    })

    document.getElementById("json").textContent = JSON.stringify(pointList, null, 2);

    let profile = "M10 10 L60 80 L120 20 L180 90 Z"
    profile = pieces.join(" ") + " Z"
    document.getElementById('output').setAttribute("d", profile);

  })
  .catch(error => {
    console.error('取得エラー:', error);
  });