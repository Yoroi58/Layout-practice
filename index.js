Array.prototype.group_by = function (f) {
  return this.reduce((acc, val) => {
    const key = f(val);
    if (acc[key] == null) {
      acc[key] = [val];
    } else {
      acc[key].push(val);
    }
    return acc;
  }, {});
};

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
  resize(points) {
    const lons = points.map((point) => point[0]);
    const lats = points.map((point) => point[1]);
    this.minLon = this.min(lons);
    this.maxLon = this.max(lons);
    this.minLat = this.min(lats);
    this.maxLat = this.max(lats);

    //const aspect = (this.maxLat - this.minLat) / (this.maxLon - this.minLon);
    //this.width = this.root.getAttribute("width") - 0;
    //this.height = aspect * this.width;
    //this.root.setAttribute("height", Math.round(this.height));

     // Canvasサイズは固定
    this.width = this.root.getAttribute("width") - 0;
    this.height = this.root.getAttribute("height") - 0;
        
    // データのアスペクト比
    const dataAspect = (this.maxLat - this.minLat) / (this.maxLon - this.minLon);
    // Canvasのアスペクト比
    const canvasAspect = this.height / this.width;
        
    // アスペクト比の比較に基づいて描画領域を計算
    if (dataAspect > canvasAspect) {
      // データが縦長：左右に余白を設ける
      this.drawHeight = this.height;
      this.drawWidth = this.drawHeight / dataAspect;
      this.offsetX = (this.width - this.drawWidth) / 2;
      this.offsetY = 0;
    } else {
      // データが横長：上下に余白を設ける
      this.drawWidth = this.width;
      this.drawHeight = this.drawWidth * dataAspect;
      this.offsetX = 0;
      this.offsetY = (this.height - this.drawHeight) / 2;
    }
 
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
  
      // データ座標を0-1の範囲に正規化
      const normalizedX = (lon - this.minLon) / (this.maxLon - this.minLon);
      const normalizedY = (lat - this.minLat) / (this.maxLat - this.minLat);
        
      // 描画領域内の座標に変換（上下反転）
      const x = this.offsetX + normalizedX * this.drawWidth;
      const y = this.offsetY + this.drawHeight - (normalizedY * this.drawHeight);
        
      return [x, y];
    /*
    return [
      ((lon - this.minLon) / (this.maxLon - this.minLon)) * this.width,
      this.height -
        ((lat - this.minLat) / (this.maxLat - this.minLat)) * this.height,
    ];*/
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

class Driver {
  read(path) {
    throw new Error("read() must be implemented");
  }
  write(path, data) {
    throw new Error("write() must be implemented");
  }
}

class HttpDriver extends Driver {
  constructor(url, parser) {
    super();
    this.url = url;
    this.parser = parser || ((text) => JSON.parse(text));
    this.cache = null; // lazy-load用
  }

  async read(path) {
    if (this.cache) return this.cache; // キャッシュ済みなら返す
    const res = await fetch(this.url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${this.url}: ${res.status}`);
    }
    const text = await res.text();
    this.cache = this.parser(text);
    return this.cache;
  }

  async write(path, data) {
    // ブラウザからは普通は書き込めない
    throw new Error("HttpDriver is read-only in browser");
  }
}

class DerivedDriver extends Driver {
  constructor(repo, depPath, transform) {
    super();
    this.repo = repo;
    this.depPath = depPath;
    this.transform = transform; // 関数: baseData -> derivedData
  }

  async read(path) {
    const baseData = this.repo.read(this.depPath);
    return this.transform(baseData);
  }

  async write(path, data) {
    throw new Error("Derived data is read-only");
  }
}

// データ管理クラス
class Repository {
  constructor() {
    this.cityOfficeLocations = null;
    this.boundaries = null;
    this.isLoaded = false;
    this.mounts = new Map(); // path -> driver
    this.cache = new Map(); // セッション内キャッシュ
  }  
  mount(path, driver) {
    this.mounts.set(path, driver);
  }

  async read(path) {
    if (this.cache.has(path))
      return this.cache.get(path); // メモ化ヒット
    
    const [basePath, queryString] = path.split("?");
    const driver = this._findDriver(basePath);
    let result = await driver.read(basePath);

    if (queryString) {
      const query = queryString.split("&").reduce((acc, q)=>{
        const [key, value] = q.split("=");
        q[key] = value;
        return q;
      })
      if (query["format"] === "text")
        result = JSON.stringify(result);
      // 他の形式も拡張可能
    }
    this.cache.set(path, result); // メモ化
    return result;
  }

  async write(path, data) {
    const driver = this._findDriver(path);
    return await driver.write(path, data);
  }

  _findDriver(path) {
    if (this.mounts.has(path)) {
      return this.mounts.get(path);
    }
    throw new Error(`No driver mounted at ${path}`);
  }

}

var controller = null;

var svg = new SVGCanvas("profile");
svg.load("./N03-21_44_210101.geojson");
var selectedCities = null;

var problems = [{
  question : "問題文",
  problemMap: "大分県",
  answers: [
    "クリック",
    "閉じる",
    "正解",
    "不正解"
  ],
  correctAnswer : 2
}]

document.forms.problem.question.value = problems[0].question;
document.forms.problem.problemMap.value = problems[0].problemMap; 
document.forms.problem.answer1.value = problems[0].answers[0];
document.forms.problem.answer2.value = problems[0].answers[1];
document.forms.problem.answer3.value = problems[0].answers[2];
document.forms.problem.answer4.value = problems[0].answers[3];
problems = [];

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const item = btn.closest('.outline-nav');
  if (!item) return;

  //const expanded = item.getAttribute('aria-expanded') === 'true';
  switch (btn.dataset.action) {
    //case 'open':   item.setAttribute('aria-expanded', 'true'); break;
    //case 'close':  item.setAttribute('aria-expanded', 'false'); break;
    //case 'toggle': item.setAttribute('aria-expanded', !expanded); break;
    /*case 'edit':   {
      e.preventDefault();
      e.stopPropagation(); // summary のトグルを完全遮断
      const label = item.querySelector('.editable-label');
      const span  = label.querySelector('.label-text');
      const input = label.querySelector('input');

      // 表示・有効化を確実に
      input.disabled = false;

      // レイアウト反映後にフォーカス
      requestAnimationFrame(() => input.focus({ preventScroll: true }));
      break;
    }*/
    case "update": 
    case "view": 
    case "add": {
      const action = btn.dataset.action;
      const order = btn.dataset.order;
      const params = {
        "update": {
          order: order - 0,
          submitButtonsStatus: true,
          problemButtonsStatus: false,
          answerButtonView: "block",
          addButtonText: "更新",
        },
        "view":{
          order: order - 0,
          submitButtonsStatus: false,
          problemButtonsStatus: true,
          answerButtonView: "none",
        },
        "add": {
          order: order || problems.length,
          submitButtonsStatus: true,
          problemButtonsStatus: false,
          answerButtonView: "block",
        }
      }
      const orderValue = params[action].order;
      document.forms.problem.order.value = orderValue;
      
      const problem = problems[orderValue];
      document.forms.problem.question.value = problem?.question ?? "問題";
      document.forms.problem.problemMap.value = problem?.problemMap ?? "大分県"; 
      document.forms.problem.answer1.value = problem?.answers[0] ?? "回答1";
      document.forms.problem.answer2.value = problem?.answers[1] ?? "回答2";
      document.forms.problem.answer3.value = problem?.answers[2] ?? "回答3";
      document.forms.problem.answer4.value = problem?.answers[3] ?? "回答4";
      document.forms.problem.correctAnswer.value = problem?.correctAnswer ?? "0";
      const submitButtons = document.forms.problem.querySelectorAll('button.card-button[type="submit"]');
      submitButtons.forEach(btn => btn.disabled = params[action].submitButtonsStatus);
      ["question", "answer1", "answer2", "answer3", "answer4"].forEach(name => {
        const input = document.forms.problem[name];
        input.disabled = params[action].problemButtonsStatus;
      });
      const addButton = document.getElementById('addButton');
      const viewStyle = params[action].answerButtonView;
      addButton.setAttribute("style", `display: ${viewStyle};`);
      addButton.innerHTML = params[action].addButtonText ?? "追加";
     document.querySelectorAll('[name="correctAnswer"]').forEach(btn => 
       btn.setAttribute("style", `display: ${viewStyle};`)
      );
      document.forms.$cities.prefecture.value = problem?.problemMap?? "" //
      controller.updateProblemMap(problem?.problemMap);

      document.getElementById('problemDialog').show();
      break;
    } 
        case "delete": {
      if(window.confirm("削除しますか？")) {
        const order = btn.dataset.order;
        problems.splice(order, 1);
        updateProblemList(problems);
      }
      break;
    }
    case 'save': {
      try {
        const json = JSON.stringify(problems, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'problems.json';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert('保存に失敗しました: ' + err.message);
      }
      return;
    }
    case 'load': {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (evt) => {
        const file = evt.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            problems = JSON.parse(e.target.result);
            updateProblemList(problems);
            alert(`${problems.length}件の問題を読み込みました`);
          } catch (err) {
            alert('ファイルの読み込みに失敗しました: ' + err.message);
          }
        };
        reader.readAsText(file);
      };
      input.click();
      return;
    }
  }
}); 

// UI更新関数（既存コードから抽出）
function updateProblemList(problems) {
  const ul = document.querySelector('[role="treeitem"]')?.querySelector('ul');
  if (!ul) return;
  /*
  ul.innerHTML = "";
  problems.forEach((problem, index) => {
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" data-action="view" data-order="${index}">${problem.question}</button>
  　<button type="button" data-action="update" data-order="${index}">変更</button>
    <button type="button" data-action="delete" data-order="${index}">削除</button> 
    <span class="drag-handle">☰</span>
    `;
  ul.appendChild(li);
  });
  */

  const range = document.createRange();
    range.selectNodeContents(ul);
    const rootFragment = range.createContextualFragment(
      problems.reduce((fragments, problem, index)=>{
      fragments += `<li draggable="true" data-index="${index}" class="draggable-item" style="white-space: nowrap;">
        <button type="button" data-action="view" data-order="${index}">${problem.question}</button>
        <button type="button" data-action="update" data-order="${index}">変更</button>
        <button type="button" data-action="delete" data-order="${index}">削除</button>
        <span class="drag-handle">☰</span>
        </li>`;
      return fragments;
    },""));
    ul.replaceChildren(rootFragment);
     // ドラッグアンドドロップ機能の設定 , これ以降全て
  let draggedElement = null; 
  let draggedIndex = null;

  // ドラッグ開始
  ul.addEventListener('dragstart', (e) => {
    if (e.target.closest('li[draggable="true"]')) {
      draggedElement = e.target.closest('li[draggable="true"]');
      draggedIndex = parseInt(draggedElement.getAttribute('data-index'));
      draggedElement.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', draggedElement.innerHTML);
    }
  });

  // ドラッグ中
  ul.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const targetLi = e.target.closest('li[draggable="true"]');
    if (targetLi && targetLi !== draggedElement) {
      const targetIndex = parseInt(targetLi.getAttribute('data-index'));
      const rect = targetLi.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      
      if (e.clientY < midpoint) {
        ul.insertBefore(draggedElement, targetLi);
      } else {
        ul.insertBefore(draggedElement, targetLi.nextSibling);
      }
    }
  });

  // ドロップ
  ul.addEventListener('drop', (e) => {
    e.preventDefault();
    
    if (draggedElement) {
      const targetLi = e.target.closest('li[draggable="true"]');
      if (targetLi && targetLi !== draggedElement) {
        const targetIndex = parseInt(targetLi.getAttribute('data-index'));
        
        // problems配列の順序を更新
        const item = problems.splice(draggedIndex, 1)[0];
        problems.splice(targetIndex, 0, item);
        
        // UIを再描画
        updateProblemList(problems);
      }
    }
  });

  // ドラッグ終了
  ul.addEventListener('dragend', (e) => {
    if (draggedElement) {
      draggedElement.classList.remove('dragging');
      draggedElement = null;
      draggedIndex = null;
    }
  });

}
  

// グローバルデータマネージャー
const repository = new Repository();
// データの初期化
(async () => {
  // リポジトリにデータを読み込む
  repository.mount("/cityOfficeLocations", new HttpDriver("./r0612puboffice_utf8.csv", (text)=>{
    let locations = text.split("\n");
    locations = locations.map((cityOffice) => cityOffice.split("\t"));
    locations.forEach((city) => {
      if (city[0].length < 5)
        city[0] = "0" + city[0];       
    });
    return locations;
  }));
  repository.mount("/boundaries", new HttpDriver("./data/N03-21_210101.json"));
  // await repository.loadData();

  let cityOfficeLocations = await repository.read("/cityOfficeLocations");
  let boundaries = await repository.read("/boundaries");
  let areaList = {
    "北海道地域" : ["北海道"],
    "東北地域": ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",],
    "関東地域": ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県"],
    "北陸地域": ["新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県"],
    "中部地域": ["岐阜県", "静岡県", "愛知県", "三重県"],
    "近畿地域": ["滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"],
    "中国地域": ["鳥取県", "島根県", "岡山県", "広島県", "山口県"],
    "四国地域": ["徳島県", "香川県", "愛媛県", "高知県"],
    "九州地域": ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県"],
    "沖縄地域": ["沖縄県"]
  }
  //repository.getCityOfficeLocations();
  selectedCities = cityOfficeLocations;

  controller = {
    changeLocalarea: (evt) =>{
      const areaName = document.forms.$cities.area.value;
      const areaPrefectures = areaList[areaName].group_by((areaName)=>areaName);
      const prefectures = document.forms.$cities.querySelectorAll('[name="prefecture"] option');
      prefectures.forEach((pref)=>{
        const displayStyle = areaPrefectures[pref.textContent] ? "inline": "none"
        pref.setAttribute("style", `display: ${displayStyle}`)
      })
      document.forms.$cities.prefecture.value = "";
      
      document.forms.problem.problemMap.value = areaName;
      const feaures = controller.updateProblemMap(areaName);
    },
    updateProblemMap: (cityName) =>{
      if(!cityName) return;    
        const prefectureNames = areaList[cityName]; //
        const areaPrefectures = prefectureNames?.group_by((prefName)=>prefName); //
      
        const features = boundaries.features
          .filter((feature) => { 
            if(prefectureNames){ //
              return areaPrefectures[feature.properties["N03_001"]] != null //
            }else //
              return feature.properties["N03_001"] == cityName
          })
        
        const polylines = features.map((feature) => {
          if (feature.geometry.type == "Polygon") {
            return [feature.geometry.coordinates];
          } else if (feature.geometry.type == "MultiPolygon") {
            return feature.geometry.coordinates;
          }
        }).flat(2); // 最後にポリライン集合として平坦化する
    
        const points = polylines.flat(1); // 一旦、ポリライン集合を点集合に変換し、描画サイズを調整
        svg.resize(points);
        const profile = svg.toCanvasCoordFromPolylines(polylines)
          .map((polyline) => svg.toPath(polyline))
          .join(" ");
        const pathNode = svg.root.querySelector("path");
        pathNode.setAttribute("d", profile);
    
        return features;
    },
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
      let city = boundaries.features.find(
        (feature) => feature.properties["N03_007"] == cityCode
      );
      if (city != null) {
        let prefectureName = city.properties["N03_001"];
        // 1. 選択した自治体を含む都道府県全体の幾何データを取得
        let indexedBoundaries= boundaries.features.group_by((feature) => {
          return feature.properties["N03_001"];
        });
        let features = indexedBoundaries[prefectureName];
        let polylines = features
          .map((feature) => {
            if (feature.geometry.type == "Polygon") {
              return [feature.geometry.coordinates];
            } else if (feature.geometry.type == "MultiPolygon") {
              return feature.geometry.coordinates;
            }
          })
          .flat(2); // 最後にポリライン集合として平坦化する

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
            : [cityCode, "庁舎なし"];
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
        if(document.forms.problem.cities.value == "problemMap"){ //(1)
        }else{ //(2)
          const text = document.querySelector('input[name="cities"]:checked ~ button input[type="text"]:first-child'); //(3)
          text.value = cityOfficeLocations[i][1]; //(4)
        } //(5)
        controller.updateLocation(i);
      }
    },
    toggle: (evt) => {
      const checked = document.forms.$cities.toggleList.checked;
      const toggleNode = document.querySelector("ul:has(input[name='oita'])");
      toggleNode.classList.toggle("filter", !checked);
    },
    answerProblem: (evt) =>{
       if(evt.target.returnValue == "cancel") return; //ここ

      if(evt.target.returnValue == "edit"){ // ここ
        const order = document.forms.problem.order.value -0;
        const problemMap = document.forms.problem.problemMap.value;
        const question = document.forms.problem.question.value;
        const answer1 = document.forms.problem.answer1.value;
        const answer2 = document.forms.problem.answer2.value;
        const answer3 = document.forms.problem.answer3.value;
        const answer4 = document.forms.problem.answer4.value;
        const correctAnswer = document.forms.problem.correctAnswer.value;
        problems[order]={
          question,
          answers : [answer1, answer2, answer3, answer4],
          correctAnswer : correctAnswer -0,
          problemMap,
        };
        updateProblemList(problems);

        }else { // ここ
        const answer = evt.target.returnValue -0;
        const order = document.forms.problem.order.value -0;
        if(answer == problems[order].correctAnswer) {
          success.showModal();
        } else {
          error.showModal();
        }
      }
    },
  }

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

  boundaries = await repository.read("/boundaries")//
  // .getBoundaries();
  let prefectureNames = boundaries.features.map(
    (feature) => feature.properties["N03_001"]
  );
  console.log("自治体の境界の数", prefectureNames.length);
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
    document.forms.problem.problemMap.value = value;
    if(document.forms.problem.cities.value == "problemMap"){
      document.forms.problem.problemMap.value = value;
      controller.updateProblemMap(value);
    }else{
      const text = document.querySelector('input[name="cities"]:checked ~ button input[type="text"]:first-child');
      text.value = value;
    }

   /* const geometries = boundaries.features
      .filter((feature) => feature.properties["N03_001"] == value)
      .map((feature) => feature.geometry);

    // 幾何データをポリラインに変換
    // ポリゴンの場合は、ポリラインを1つしか持っていない
    // マルチポリゴンの場合は、ポリラインを複数持っている
    const polylines = geometries
      .map((geometry) => {
        if (geometry.type == "Polygon") {
          return [geometry.coordinates];
        } else if (geometry.type == "MultiPolygon") {
          return geometry.coordinates;
        }
      })
      .flat(2); // 最後にポリライン集合として平坦化する

    const points = polylines.flat(1); // 一旦、ポリライン集合を点集合に変換し、描画サイズを調整
    svg.resize(points);
    // ポリラインを描画座標に変換した後、svgに描画
    const profile = svg
      .toCanvasCoordFromPolylines(polylines)
      .map((polyline) => svg.toPath(polyline))
      .join(" ");
    const pathNode = svg.root.querySelector("path");
    pathNode.setAttribute("d", profile);
    */
    // 2. 選択した都道府県の自治体コードたちN03_007の配列を作る
    const features = boundaries.features.filter(
      (feature) => feature.properties["N03_001"] == value
    );
    // feature.properties["N03_007"]が自治体コード
    const groupedCities = cityOfficeLocations.group_by(
      (location) => location[0]
    );

    // 3. この自治体コード配列の要素それぞれについて、庁舎データを参照し緯度経度データを取得する
    let cities = features.map((feature) => {
      const cityCode = feature.properties["N03_007"];
      const cityOfficeLocation = groupedCities[cityCode]
        ? groupedCities[cityCode][0]
        : [cityCode, "庁舎なし"];
      return cityOfficeLocation;
    });
    console.log(cities);
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
    if (base.nextElementSibling != null)
      base.parentNode.removeChild(base.nextElementSibling);
    base.parentNode.appendChild(ul);
  });
})();
