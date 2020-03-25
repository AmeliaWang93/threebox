const DEBUG=false;

const WORLD_SIZE = 1024000;
const MERCATOR_A = 6378137.0;

Constants = {
    WORLD_SIZE: WORLD_SIZE,
    PROJECTION_WORLD_SIZE: WORLD_SIZE / (MERCATOR_A * Math.PI * 2),
    MERCATOR_A: MERCATOR_A, // 900913 projection property
    DEG2RAD: Math.PI / 180,
    RAD2DEG: 180 / Math.PI,
    EARTH_CIRCUMFERENCE: 40075000, // In meters
}

class TileSet
{
  constructor(){
    this.url = null;
    this.version = null;
    this.gltfUpAxis = 'Z';
    this.geometricError = null;
    this.root = null;
  }
  async load(url, styleParams) {
    this.url = url;
    let resourcePath = THREE.LoaderUtils.extractUrlBase(url);        
    let response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    }
    let json = await response.json();
    this.version = json.asset.version;
    this.geometricError = json.geometricError;
    this.refine = json.refine ? json.refine.toUpperCase() : 'ADD';
    this.root = new ThreeDeeTile(json.root, resourcePath, styleParams, this.refine, true);        
  }
}

class  ThreeDeeTile
{
  constructor(json, resourcePath, styleParams, parentRefine, isRoot) {
    this.loaded = false;
    this.styleParams = styleParams;
    this.resourcePath = resourcePath;
    this.totalContent = new THREE.Group();	// Three JS Object3D Group for this tile and all its children
    this.tileContent = new THREE.Group();		// Three JS Object3D Group for this tile's content
    this.childContent = new THREE.Group();		// Three JS Object3D Group for this tile's children
    this.totalContent.add(this.tileContent);
    this.totalContent.add(this.childContent);
    this.boundingVolume = json.boundingVolume;
    if (this.boundingVolume && this.boundingVolume.box) {
      let b = this.boundingVolume.box;
      let extent = [b[0] - b[3], b[1] - b[7], b[0] + b[3], b[1] + b[7]];
      let sw = new THREE.Vector3(extent[0], extent[1], b[2] - b[11]);
      let ne = new THREE.Vector3(extent[2], extent[3], b[2] + b[11]);
      this.box = new THREE.Box3(sw, ne);
      if (DEBUG) {
        let geom = new THREE.BoxGeometry(b[3] * 2, b[7] * 2, b[11] * 2);
        let edges = new THREE.EdgesGeometry( geom );
        let line = new THREE.LineSegments( edges, new THREE.LineBasicMaterial( { color: 0x800000 } ) );
        let trans = new THREE.Matrix4().makeTranslation(b[0], b[1], b[2]);
        line.applyMatrix4(trans);
        this.totalContent.add(line);
      }
    } else {
      this.extent = null;
      this.sw = null;
      this.ne = null;
      this.box = null;
      this.center = null;
    }
    this.refine = json.refine ? json.refine.toUpperCase() : parentRefine;
    this.geometricError = json.geometricError;
    this.transform = json.transform;
    if (this.transform) { // && !isRoot) { 
      // if not the root tile: apply the transform to the THREE js Group
      // the root tile transform is applied to the camera while rendering
      let tileMatrix = new THREE.Matrix4().fromArray(this.transform);
      let scale = Constants.PROJECTION_WORLD_SIZE;
      //tileMatrix.elements[14] = 0;
      let transform2ThreeBox = new THREE.Matrix4().makeScale(-scale, -scale, scale);
      this.totalContent.applyMatrix4(transform2ThreeBox.multiply(tileMatrix));
    }
    this.content = json.content;
    this.children = [];
    if (json.children) {
      for (let i=0; i<json.children.length; i++){
        let child = new ThreeDeeTile(json.children[i], resourcePath, styleParams, this.refine, false);
        this.childContent.add(child.totalContent);
        this.children.push(child);
      }
    }
  }
  async load() {
    this.tileContent.visible = true;
    this.childContent.visible = true;
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    if (this.content) {
      let url = this.content.uri ? this.content.uri : this.content.url;
      if (!url) return;
      if (url.substr(0, 4) != 'http')
        url = this.resourcePath + url;
      let type = url.slice(-4);
      if (type == 'json') {
        // child is a tileset json
        let tileset = new TileSet();
        await tileset.load(url, this.styleParams);
        this.children.push(tileset.root);
        if (tileset.root) {
          if (tileset.root.transform) {
              // the root tile transform of a tileset is normally not applied because
              // it is applied by the camera while rendering. However, in case the tileset 
              // is a subset of another tileset, so the root tile transform must be applied 
              // to the THREE js group of the root tile.
              tileset.root.totalContent.applyMatrix4(new THREE.Matrix4().fromArray(tileset.root.transform));
          }
          this.childContent.add(tileset.root.totalContent);
        }        
      } else if (type == 'b3dm') {
        let loader = new THREE.GLTFLoader();
        let b3dm = new B3DM(url);
        let rotateX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        this.tileContent.applyMatrix4(rotateX); // convert from GLTF Y-up to Z-up
        let d = await b3dm.load();
        loader.parse(d.glbData, this.resourcePath, (gltf) => {
              //Add the batchtable to the userData since gltLoader doesn't deal with it
              gltf.scene.children[0].userData = d.batchTableJson;
              //var meshMaterial = new THREE.MeshNormalMaterial({color: 0x7777ff});
              // fix for GLTFLoader createDefaultMaterial and THREE.REVISION 114
							gltf.scene.traverse(child => {
                if (child.material) {
                  child.material.depthWrite = true; 
                }
              });
              if (this.styleParams.color != null || this.styleParams.opacity != null) {
                let color = new THREE.Color(self.styleParams.color);
                gltf.scene.traverse(child => {
                  
                  if (child instanceof THREE.Mesh) {
                    if (this.styleParams.color != null) 
                      child.material.color = color;
                    if (this.styleParams.opacity != null) {
                      child.material.opacity = this.styleParams.opacity;
                      child.material.transparent = this.styleParams.opacity < 1.0 ? true : false;
                    }
                  }
                });
              }
              let children = gltf.scene.children;
          /*
              for (let i=0; i<children.length; i++) {
                if (children[i].isObject3D) 
                  self.tileContent.add(children[i]);
              }*/
              this.tileContent.add(gltf.scene);
            }, function(e) {
              throw new Error('error parsing gltf: ' + e);
            }
        );
      } else if (type == 'pnts') {
        let pnts = new PNTS(url);
        let d = await pnts.load()
          
        let geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(d.points, 3));
        let material = new THREE.PointsMaterial();
        material.size = this.styleParams.pointsize != null ? this.styleParams.pointsize : 1.0;
        if (this.styleParams.color) {
          material.vertexColors = THREE.NoColors;
          material.color = new THREE.Color(this.styleParams.color);
          material.opacity = this.styleParams.opacity != null ? this.styleParams.opacity : 1.0;
        } else if (d.rgba) {
          geometry.setAttribute('color', new THREE.Float32BufferAttribute(d.rgba, 4));
          material.vertexColors = THREE.VertexColors;
        } else if (d.rgb) {
          geometry.setAttribute('color', new THREE.Float32BufferAttribute(d.rgb, 3));
          material.vertexColors = THREE.VertexColors;
        }
        this.tileContent.add(new THREE.Points( geometry, material ));
        if (d.rtc_center) {
          let c = d.rtc_center;
          this.tileContent.applyMatrix4(new THREE.Matrix4().makeTranslation(c[0], c[1], c[2]));
        }
        this.tileContent.add(new THREE.Points( geometry, material ));
          
      } else if (type == 'i3dm') {
        throw new Error('i3dm tiles not yet implemented');					
      } else if (type == 'cmpt') {
        throw new Error('cmpt tiles not yet implemented');
      } else {
        throw new Error('invalid tile type: ' + type);
      }
    }
  }
  unload(includeChildren) {
    this.tileContent.visible = false;
    if (includeChildren) {
      this.childContent.visible = false;
    } else  {
      this.childContent.visible = true;
    }
    // TODO: should we also free up memory?
  }
  checkLoad(frustum, cameraPosition) {
    // is this tile visible?
    /*
    if (!frustum.intersectsBox(this.box)) {
      this.unload(true);
      return;
    }
    

    let dist = this.box.distanceToPoint(cameraPosition);

    //console.log(`dist: ${dist}, geometricError: ${this.geometricError}`);
    // are we too far to render this tile?
    if (this.geometricError > 0.0 && dist > this.geometricError * 50.0) {
      this.unload(true);
      return;
    }
    */
let dist = 0;
    // should we load this tile?
    if (this.refine == 'REPLACE' && dist < this.geometricError * 20.0) {
      this.unload(false);
    } else {
      this.load();
    }

    // should we load its children?
    for (let i=0; i<this.children.length; i++) {
      if (dist < this.geometricError * 20.0) {
        this.children[i].checkLoad(frustum, cameraPosition);
      } else {
        this.children[i].unload(true);
      }
    }

    /*
    // below code loads tiles based on screenspace instead of geometricError,
    // not sure yet which algorith is better so i'm leaving this code here for now
    let sw = this.box.min.clone().project(camera);
    let ne = this.box.max.clone().project(camera);			
    let x1 = sw.x, x2 = ne.x;
    let y1 = sw.y, y2 = ne.y;
    let tilespace = Math.sqrt((x2 - x1)*(x2 - x1) + (y2 - y1)*(y2 - y1)); // distance in screen space

    if (tilespace < 0.2) {
      this.unload();
    }
    // do nothing between 0.2 and 0.25 to avoid excessive tile loading/unloading
    else if (tilespace > 0.25) {
      this.load();
      this.children.forEach(child => {
        child.checkLoad(camera);
      });
    }*/

  }
}

class TileLoader {
  // This class contains the common code to load tile content, such as b3dm and pnts files.
  // It is not to be used directly. Instead, subclasses are used to implement specific 
  // content loaders for different tile types.
  constructor(url) {
    this.url = url;
    this.type = url.slice(-4);
    this.version = null;
    this.byteLength = null;
    this.featureTableJSON = null;
    this.featureTableBinary = null;
    this.batchTableJson = null;
    this.batchTableBinary = null;
    this.binaryData = null;
  }
  load() {
    let self = this;
    return new Promise((resolve, reject) => {
      fetch(self.url)
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} - ${response.statusText}`);
          }
          return response;
        })
        .then(response => response.arrayBuffer())
        .then(buffer => self.parseResponse(buffer))
        .then(res => resolve(res))
        .catch(error => {
          reject(error);
        });
    });		
  }
  parseResponse(buffer) {
    let header = new Uint32Array(buffer.slice(0, 28));
    let decoder = new TextDecoder();
    let magic = decoder.decode(new Uint8Array(buffer.slice(0, 4)));
    if (magic != this.type) {
      throw new Error(`Invalid magic string, expected '${this.type}', got '${this.magic}'`);
    }
    this.version = header[1];
    this.byteLength = header[2];
    let featureTableJSONByteLength = header[3];
    let featureTableBinaryByteLength = header[4];
    let batchTableJsonByteLength = header[5];
    let batchTableBinaryByteLength = header[6];
    
    /*
    console.log('magic: ' + magic);
    console.log('version: ' + this.version);
    console.log('featureTableJSONByteLength: ' + featureTableJSONByteLength);
    console.log('featureTableBinaryByteLength: ' + featureTableBinaryByteLength);
    console.log('batchTableJsonByteLength: ' + batchTableJsonByteLength);
    console.log('batchTableBinaryByteLength: ' + batchTableBinaryByteLength);
    */
    
    let pos = 28; // header length
    if (featureTableJSONByteLength > 0) {
      this.featureTableJSON = JSON.parse(decoder.decode(new Uint8Array(buffer.slice(pos, pos+featureTableJSONByteLength))));
      pos += featureTableJSONByteLength;
    } else {
      this.featureTableJSON = {};
    }
    this.featureTableBinary = buffer.slice(pos, pos+featureTableBinaryByteLength);
    pos += featureTableBinaryByteLength;
    if (batchTableJsonByteLength > 0) {
      this.batchTableJson = JSON.parse(decoder.decode(new Uint8Array(buffer.slice(pos, pos+batchTableJsonByteLength))));
      pos += batchTableJsonByteLength;
    } else {
      this.batchTableJson = {};
    }
    this.batchTableBinary = buffer.slice(pos, pos+batchTableBinaryByteLength);
    pos += batchTableBinaryByteLength;
    this.binaryData = buffer.slice(pos);
    return this;
  }
}

class B3DM extends TileLoader {
  constructor(url) {
    super(url);
    this.glbData = null;
  }
  parseResponse(buffer) {
    super.parseResponse(buffer);
    this.glbData = this.binaryData;
    return this;
  }
}

class PNTS extends TileLoader{
  constructor(url) {
    super(url);
    this.points = new Float32Array();
    this.rgba = null;
    this.rgb = null;
  }
  parseResponse(buffer) {
    super.parseResponse(buffer);
    if (this.featureTableJSON.POINTS_LENGTH && this.featureTableJSON.POSITION) {
      let len = this.featureTableJSON.POINTS_LENGTH;
      let pos = this.featureTableJSON.POSITION.byteOffset;
      this.points = new Float32Array(this.featureTableBinary.slice(pos, pos + len * Float32Array.BYTES_PER_ELEMENT * 3));
      this.rtc_center = this.featureTableJSON.RTC_CENTER;
      if (this.featureTableJSON.RGBA) {
        pos = this.featureTableJSON.RGBA.byteOffset;
        let colorInts = new Uint8Array(this.featureTableBinary.slice(pos, pos + len * Uint8Array.BYTES_PER_ELEMENT * 4));
        let rgba = new Float32Array(colorInts.length);
        for (let i=0; i<colorInts.length; i++) {
          rgba[i] = colorInts[i] / 255.0;
        }
        this.rgba = rgba;
      } else if (this.featureTableJSON.RGB) {
        pos = this.featureTableJSON.RGB.byteOffset;
        let colorInts = new Uint8Array(this.featureTableBinary.slice(pos, pos + len * Uint8Array.BYTES_PER_ELEMENT * 3));
        let rgb = new Float32Array(colorInts.length);
        for (let i=0; i<colorInts.length; i++) {
          rgb[i] = colorInts[i] / 255.0;
        }
        this.rgb = rgb;
      } else if (this.featureTableJSON.RGB565) {
        console.error('RGB565 is currently not supported in pointcloud tiles.')
      }
    }
    return this;
  }
}
