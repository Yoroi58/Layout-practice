Array.prototype.group_by = function(f){
  return this.reduce((acc, val)=>{
    const key = f(val);
    if(acc[key] == null){
      acc[key] = [val]
    }else{
      acc[key].push(val);
    }
    return acc;
  }, {})
}


class SVGCanvas {
  constructor(id) {
    this.id = id;
    this.root = document.getElementById(id);
  }
  load(filename) {
    return fetch(filename)
      .then((response) => response.json())
      .then((geojson) => {
        const features = geojson.features;
        const polylines = features.map((feature) => {
          return feature.geometry.coordinates[0];
        });

        const points = polylines.flat(1);
        // 2. 最大・最小を求める
        // const minLon = Math.min(...lons), maxLon = Math.max(...lons);
        // const minLat = Math.min(...lats), maxLat = Math.max(...lats);

        // 3. 描画するSVG/Canvasのサイズを調整
        this.resize(points);

        // 4. 緯度経度→SVG座標変換
        const svgCoordPolylines = this.toCanvasCoordFromPolylines(polylines);
        const profile = svgCoordPolylines
          .map((polyline) => this.toPath(polyline))
          .join(" ");

        const pathNode = this.root.querySelector("path");
        pathNode.setAttribute("d", profile);
      });
  }
  resize(points){
    const lons = points.map((point) => point[0]);
    const lats = points.map((point) => point[1]);
    this.minLon = this.min(lons);
    this.maxLon = this.max(lons);
    this.minLat = this.min(lats);
    this.maxLat = this.max(lats);

    const aspect = (this.maxLat - this.minLat) / (this.maxLon - this.minLon);
    this.width = this.root.getAttribute("width") - 0;
    this.height = aspect * this.width;
    this.root.setAttribute("height", Math.round(this.height));  
  }
  min(ary) {
    return ary.reduce((a, b) => Math.min(a, b));
  }
  max(ary) {
    return ary.reduce((a, b) => Math.max(a, b));
  }

  toCanvasCoordFromPolylines(polylines) {
    return polylines.map((polyline) =>
      this.toCanvasCoordFromPolyline(polyline)
    );
  }
  toCanvasCoordFromPolyline(polyline) {
    return polyline.map((point) => this.toCanvasCoordFromPoint(point));
  }
  toCanvasCoordFromPoint([lon, lat]) {
    return [
      ((lon - this.minLon) / (this.maxLon - this.minLon)) * this.width,
      this.height -
        ((lat - this.minLat) / (this.maxLat - this.minLat)) * this.height,
    ];
  }
  toPath(polyline) {
    const first = polyline[0];
    const last = polyline[polyline.length - 1];
    return (
      polyline
        .map((point, i) => {
          const [lon, lat] = point;
          const prefix = i < 1 ? "M" : "L";
          return prefix + lon + " " + lat;
        })
        .join(" ") + (first[0] == last[0] && first[1] == last[1] ? " Z" : "")
    );
  }
}

// データ管理クラス
class Repository {
  constructor() {
    this.cityOfficeLocations = null;
    this.boundaries = null;
    this.isLoaded = false;
  }

  // データを読み込む
  async loadData() {
    if (this.isLoaded) return;
    
    try {
      // 庁舎データの読み込み
      const response1 = await fetch("./r0612puboffice_utf8.csv");
      const text = await response1.text();
      
      let locations = text.split("\n");
      locations = locations.map((cityOffice) => cityOffice.split("\t"));
      
      locations.forEach((city) => {
        if(city[0].length < 5) {
          city[0] = "0" + city[0];
        }
      });
      
      this.cityOfficeLocations = locations;

      // 境界データの読み込み
      const response2 = await fetch("./data/N03-21_210101.json");
      this.boundaries = await response2.json();
      
      this.isLoaded = true;
      console.log("データの読み込みが完了しました");
    } catch (error) {
      console.error("データの読み込みに失敗しました:", error);
    }
  }

  // 同期的に庁舎データを取得
  getCityOfficeLocations() {
    if (!this.isLoaded) {
      throw new Error("データがまだ読み込まれていません。loadData()を先に呼び出してください。");
    }
    return this.cityOfficeLocations;
  }

  // 同期的に境界データを取得
  getBoundaries() {
    if (!this.isLoaded) {
      throw new Error("データがまだ読み込まれていません。loadData()を先に呼び出してください。");
    }
    return this.boundaries;
  }
}

var controller = null

var svg = new SVGCanvas("profile");
svg.load("./N03-21_44_210101.geojson");
var selectedCities = null;

// グローバルデータマネージャー
const repository = new Repository();

// データの初期化
(async () => {
  // データマネージャーでデータを読み込む
  await repository.loadData();
  // 同期的にデータを取得
  let cityOfficeLocations = repository.getCityOfficeLocations();
  selectedCities = cityOfficeLocations;

    controller = {
    nextLocation: (evt) => {
      evt.preventDefault();
      const i = Math.floor(Math.random() * cityOfficeLocations.length);
      controller.updateLocation(i);
    },
    updateLocation: (i) => {
      const cityOffice = cityOfficeLocations[i];
      let lng = cityOffice[9] - 0;
      let lat = cityOffice[8] - 0;
            let cityCode = cityOffice[0];
      let city = repository.boundaries.features.find(
        (feature) => feature.properties["N03_007"] == cityCode
      );
      if (city != null) {
        let prefectureName = city.properties["N03_001"];
        let geometries = repository.boundaries.features.group_by((feature) => {
          return feature.properties["N03_001"];
        });
        let features = geometries[prefectureName]; // ここが本日の目的の処理！
        let polylines = features
          .map((feature) => {
            if (feature.geometry.type == "Polygon") {
              return feature.geometry.coordinates;
            } else if (feature.geometry.type == "MultiPolygon") {
              return feature.geometry.coordinates[0];
            }
          })
          .flat(1); // 最後にポリライン集合として平坦化する

        const points = polylines.flat(1); // 一旦、ポリライン集合を点集合に変換し、描画サイズを調整
        svg.resize(points);

        // ポリラインを描画座標に変換した後、svgに描画
        const profile = svg
          .toCanvasCoordFromPolylines(polylines)
          .map((polyline) => svg.toPath(polyline))
          .join(" ");
        const pathNode = svg.root.querySelector("path");
        pathNode.setAttribute("d", profile);

        // feature.properties["N03_007"]が自治体コード
        const groupedCities = cityOfficeLocations.group_by(
          (location) => location[0]
        );

        // 3. この自治体コード配列の要素それぞれについて、庁舎データを参照し緯度経度データを取得する
        let cities = features.map((feature) => {
          const cityCode = feature.properties["N03_007"];
          const cityOfficeLocation = groupedCities[cityCode]
            ? groupedCities[cityCode][0]
            : null;
          return cityOfficeLocation;
        });
        // 配列からリストを生成 ... 1対1の時は ... ?
        const list = cities.map((city) => {
          let value = city[0];
          let name = city[1];
          const li = document.createElement("li");
          li.innerHTML =
            '<label><input type="radio" name="oita" value="' +
            value +
            '" onchange="controller.pickCity(event)">' +
            name +
            "</label>";
          return li;
        });

        // 配列をある一つの要素にするには...? 集約機能だからreduce を使う
        const ul = document.createElement("ul");
        ul.classList.add("filter");
        list.reduce((root, li) => {
          root.append(li);
          return root;
        }, ul);

        // ulを加える。どこに？ <h2>自治体</h2>の弟ノードにしたい

        let base = document.querySelector("aside h2:last-of-type");
        if (base.nextElementSibling != null)
          base.parentNode.removeChild(base.nextElementSibling);
        base.parentNode.appendChild(ul);
        document.forms.$cities.prefecture.value = prefectureName;
      }
      let [cx, cy] = svg.toCanvasCoordFromPoint([lng, lat]);
      const circle = svg.root.querySelector("circle");
      circle.setAttribute("cx", cx);
      circle.setAttribute("cy", cy);
      document.forms.$cities.oita.value = cityOffice[0];
    },
    pickCity: (evt) => {
      const key = document.forms.$cities.oita.value;
      const i = cityOfficeLocations.findIndex((city) => city[0] == key);
      if (i > -1) {
        controller.updateLocation(i);
      }
    },
    toggle: (evt) => {
      const checked = document.forms.$cities.toggleList.checked;
      const toggleNode = document.querySelector("ul:has(input[name='oita'])");
      toggleNode.classList.toggle("filter", !checked);
    }
  };
  /* 
// 大分県の18自治体データ
cities = {"44000": "大分県",
  "44201": "大分市", 
  "44202": "別府市", 
  "44203": "中津市", 
  "44204": "日田市", 
  "44205": "佐伯市",
  "44206": "臼杵市", 
  "44207": "津久見市", 
  "44208": "竹田市", 
  "44209": "豊後高田市", 
  "44210": "杵築市",
  "44211": "宇佐市", 
  "44212": "豊後大野市", 
  "44213": "由布市", 
  "44214": "国東市",
  "44322": "姫島村", 
  "44341": "日出町", 
  "44461": "九重町", 
  "44462": "玖珠町"
};
*/

  var cities = cityOfficeLocations.reduce((cityList, city) => {
    let value = city[0];
    let name = city[1];
    cityList[value] = name;
    return cityList;
  }, {});

  // 配列からリストを生成 ... 1対1の時は ... ?
  const list = Object.entries(cities).map(([value, name]) => {
    const li = document.createElement("li");
    li.innerHTML =
      '<label><input type="radio" name="oita" value="' +
      value +
      '" onchange="controller.pickCity(event)">' +
      name +      
      "</label>";
    return li;
  });

  // 配列をある一つの要素にするには...? 集約機能だからreduce を使う
  const ul = document.createElement("ul");
  ul.classList.add("filter");
  list.reduce((root, li) => {
    root.append(li);
    return root;
  }, ul);

  // ulを加える。どこに？ <h2>自治体</h2>の弟ノードにしたい
  let base = document.querySelector("aside h2:last-child");
  base.parentNode.appendChild(ul);

  const boundaries = repository.getBoundaries();
  let prefectureNames = boundaries.features.map((feature) => feature.properties["N03_001"]);
  console.log("自治体の境界の数", prefectureNames.length)
  prefectureNames = [...new Set(prefectureNames)]; // 手っ取り早く重複を削除
  console.log("都道府県のリスト", prefectureNames);

  const list2 = prefectureNames.map((value) => {
    const option = document.createElement("option");
    option.textContent = value;
    return option;
  });

  const select = document.querySelector("select[name='prefecture']");
  select.innerHTML = ""; // 初期化
  list2.reduce((root, option) => {
    root.appendChild(option);
    return root;
  }, select);

  select.addEventListener("change", (evt) => {
    const value = evt.target.value;
    // alert(value);
    // 1. 選択した都道府県に含まれる幾何データを取得
    const geometries = boundaries.features.filter((feature) => feature.properties["N03_001"] == value).map((feature)=>feature.geometry);

    // 幾何データをポリラインに変換
    // ポリゴンの場合は、ポリラインを1つしか持っていない
    // マルチポリゴンの場合は、ポリラインを複数持っている
    const polylines= geometries.map((geometry=>{
      if(geometry.type == "Polygon"){
        return geometry.coordinates;
      }else if(geometry.type == "MultiPolygon"){
        return geometry.coordinates[0];
      }
    })).flat(1) // 最後にポリライン集合として平坦化する

    const points = polylines.flat(1); // 一旦、ポリライン集合を点集合に変換し、描画サイズを調整
    svg.resize(points);
    // ポリラインを描画座標に変換した後、svgに描画
    const profile = svg.toCanvasCoordFromPolylines(polylines).map((polyline)=>svg.toPath(polyline)).join(" ");
    const pathNode = svg.root.querySelector("path");
    pathNode.setAttribute("d", profile);

    // 2. 選択した都道府県の自治体コードたちN03_007の配列を作る
    const features = boundaries.features.filter((feature)=>feature.properties["N03_001"] == value);
    // feature.properties["N03_007"]が自治体コード
    const groupedCities = cityOfficeLocations.group_by((location)=>location[0]);

    // 3. この自治体コード配列の要素それぞれについて、庁舎データを参照し緯度経度データを取得する
    let cities = features.map((feature)=>{
      const cityCode = feature.properties["N03_007"];
      const cityOfficeLocation = groupedCities[cityCode] ? groupedCities[cityCode][0] : null;
      return cityOfficeLocation;
    })
    console.log(cities)
    selectedCities = cities;

  // 配列からリストを生成 ... 1対1の時は ... ?
  const list = cities.map((city) => {
    let value = city[0];
    let name = city[1];
    const li = document.createElement("li");
    li.innerHTML =
      '<label><input type="radio" name="oita" value="' +
      value +
      '" onchange="controller.pickCity(event)">' +
      name +      
      "</label>";
    return li;
  });

  // 配列をある一つの要素にするには...? 集約機能だからreduce を使う
  const ul = document.createElement("ul");
  ul.classList.add("filter");
  list.reduce((root, li) => {
    root.append(li);
    return root;
  }, ul);

    // ulを加える。どこに？ <h2>自治体</h2>の弟ノードにしたい
    
    let base = document.querySelector("aside h2:last-of-type");
    if(base.nextElementSibling != null)
      base.parentNode.removeChild(base.nextElementSibling);
    base.parentNode.appendChild(ul);

  });

})();
