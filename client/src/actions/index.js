import * as globals from "../globals";
import { API } from "../globals";
import { AnnoMatrixLoader, AnnoMatrixObsCrossfilter } from "../annoMatrix";
import {
  catchErrorsWrap,
  doJsonRequest,
  dispatchNetworkErrorMessageToUser,
} from "../util/actionHelpers";
import {
  requestReembed, requestPreprocessing
} from "./reembed";
import {
  requestSankey
} from "./sankey";
import {
  requestLeiden
} from "./leiden";
import {
  postNetworkErrorToast,
  postAsyncSuccessToast,
  postAsyncFailureToast,
} from "../components/framework/toasters";
import { loadUserColorConfig } from "../util/stateManager/colorHelpers";
import * as selnActions from "./selection";
import * as annoActions from "./annotation";
import * as viewActions from "./viewStack";
import * as embActions from "./embedding";
import * as genesetActions from "./geneset";
import { defaultReembedParams } from "../reducers/reembed";
import { _switchEmbedding } from "./embedding";
import { Dataframe } from "../util/dataframe";

/*
return promise fetching user-configured colors
*/
async function userColorsFetchAndLoad(dispatch) {
  return fetchJson("colors").then((response) =>
    dispatch({
      type: "universe: user color load success",
      userColors: loadUserColorConfig(response),
    })
  );
}

async function schemaFetch() {
  return fetchJson("schema");
}
async function userInfoAuth0Fetch() {
  return fetchJson("userInfo");
}
async function hostedModeFetch() {
  return fetchJson("hostedMode");
}
async function jointModeFetch() {
  return fetchJson("jointMode");
}
async function initializeFetch() {
  return fetchJson("initialize");
}

async function configFetch(dispatch) {
  return fetchJson("config").then((response) => {
    const config = { ...globals.configDefaults, ...response.config };
    dispatch({
      type: "configuration load complete",
      config,
    });
    return config;
  });
}

export async function userInfoFetch(dispatch) {
  return fetchJson("userinfo").then((response) => {
    const { userinfo: userInfo } = response || {};
    dispatch({
      type: "userInfo load complete",
      userInfo,
    });
    return userInfo;
  });
}

async function genesetsFetch(dispatch, config) {
  /* request genesets ONLY if the backend supports the feature */
  const defaultResponse = {
    genesets: {}
  };
  if (config?.parameters?.annotations_genesets ?? false) {
    fetchJson("genesets").then((response) => {
      dispatch({
        type: "geneset: initial load",
        data: response ? response : defaultResponse,
      });
    });
  } else {
    dispatch({
      type: "geneset: initial load",
      data: defaultResponse,
    });
  }
}
export async function reembedParamsFetch(dispatch) {
  /* request reembedding parameters ONLY if the backend supports the feature */
  const defaultResponse = {
    reembedParams: defaultReembedParams,
  };
  try {
    fetchJson("reembed-parameters").then((response) => {
      const isEmpty = Object.keys(response.reembedParams).length === 0;
      dispatch({
        type: "reembed: load",
        params: isEmpty
          ? defaultResponse.reembedParams
          : response.reembedParams ?? defaultResponse.reembedParams,
      });
    });
  } catch (e) {
    dispatch({
      type: "reembed: load",
      data: defaultResponse,
    });
  }
}
export const reembedParamsObsmFetch = (embName) => async (
  dispatch,
  getState
) => {
  const { controls } = getState();
  const { username } = controls;
  const defaultResponse = defaultReembedParams;
  const res = await fetch(
    `${API.prefix}${API.version}reembed-parameters-obsm`,
    {
      method: "PUT",
      headers: new Headers({
        Accept: "application/octet-stream",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        embName: embName
      }),
      credentials: "include",
    },
  );
  const response = await res.json();

  const isEmpty = Object.keys(response.reembedParams).length === 0;
  if (!isEmpty){
    dispatch({
      type: "reembed: load",
      params: response.reembedParams,
    }); 
  }
}

function prefetchEmbeddings(annoMatrix) {
  /*
  prefetch requests for all embeddings
  */
  const { schema } = annoMatrix;
  const available = schema.layout.obs.map((v) => v.name);
  available.forEach((embName) => annoMatrix.prefetch("emb", embName));
  //available.forEach((embName) => annoMatrix.prefetch("jemb", embName));
}

function abortableFetch(request, opts, timeout = 0) {
  const controller = new AbortController();
  const { signal } = controller;

  return {
    abort: () => controller.abort(),
    isAborted: () => signal.aborted,
    ready: () => {
      if (timeout) {
        setTimeout(() => controller.abort(), timeout);
      }
      return fetch(request, { ...opts, signal });
    },
  };
}

export const downloadData = () => async (
  dispatch,
  getState
) => {
    dispatch({
      type: "output data: request start"
    }); 

    const state = getState();
    const { annoMatrix, layoutChoice, controls } = state;
    const { wsDownloadAnndata } = controls;
    
    let cells = annoMatrix.rowIndex.labels();  
    cells = Array.isArray(cells) ? cells : Array.from(cells);

    const annoNames = [];
    for (const item of annoMatrix.schema.annotations?.obs?.columns) {
      annoNames.push(item.name)
    }
    wsDownloadAnndata.send(JSON.stringify({
      labelNames: annoNames,
      currentLayout: layoutChoice.current,
      filter: { obs: { index: cells } }
    }))
   
}

export const downloadMetadata = () => async (
  dispatch,
  getState
) => {
    const state = getState();
    const { layoutChoice, annoMatrix, sankeySelection } = state;
    const { categories } = sankeySelection;
    const categoriesKeys = Object.keys(categories);
    let catNames;
    catNames = [];
    for (const item of annoMatrix.schema.annotations?.obs?.columns) {
      if (item.name !== "name_0" && categoriesKeys.includes(item.name)){
        catNames.push(item.name)
      }
    }     
    let cells = annoMatrix.rowIndex.labels();  
    cells = Array.isArray(cells) ? cells : Array.from(cells);
    dispatch({
      type: "output data: request start"
    });
    
    const res = await fetch(
      `${API.prefix}${API.version}downloadMetadata`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          labelNames: catNames,
          filter: { obs: { index: cells } }
        }),
        credentials: "include",
        }
    );

    const blob = await res.blob()

    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: `${layoutChoice.current}_obs.txt`.split(";").join("_"),
        types: [
          {
            description: 'Txt Files',
            accept: {
              'text/plain': ['.txt'],
            },
          },
        ],
      });
    } catch {
      dispatch({
        type: "output data: request completed"
      });
      return; 
    }


    
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    postAsyncSuccessToast("Downloaded cell metadata successfully");
    dispatch({
      type: "output data: request completed"
    });    

}

export const downloadVarMetadata = () => async (
  dispatch,
  getState
) => {
    const state = getState();
    const { layoutChoice } = state;

    dispatch({
      type: "output data: request start"
    });
    
    const res = await fetch(
      `${API.prefix}${API.version}downloadVarMetadata`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          embName: layoutChoice.current
        }),
        credentials: "include",
        }
    );

    const blob = await res.blob()

    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: `${layoutChoice.current}_var.txt`.split(";").join("_"),
        types: [
          {
            description: 'Txt Files',
            accept: {
              'text/plain': ['.txt'],
            },
          },
        ],
      });
    } catch { 
      dispatch({
        type: "output data: request completed"
      });
  
      return; 
    }

    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    postAsyncSuccessToast("Downloaded gene metadata successfully");
    dispatch({
      type: "output data: request completed"
    });    
}

export const downloadGenedata = () => async (
  dispatch,
  _getState
) => {
    
  dispatch({
      type: "output data: request start"
    });
    
    const res = await fetch(
      `${API.prefix}${API.version}downloadGenedata`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        credentials: "include",
        }
    );

    const blob = await res.blob()

    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: "gene-sets.csv",
        types: [
          {
            description: 'Csv Files',
            accept: {
              'text/plain': ['.csv'],
            },
          },
        ],
      });
    } catch { 
      dispatch({
        type: "output data: request completed"
      });      
      return; 
    }

    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    postAsyncSuccessToast("Downloaded gene sets successfully");
    dispatch({
      type: "output data: request completed"
    });    
}
export const requestSaveAnndataToFile = (saveName) => async (
  dispatch,
  getState
) => {
  try{
    const state = getState();
    const { annoMatrix, layoutChoice, controls } = state;
    
    let cells = annoMatrix.rowIndex.labels();  
    cells = Array.isArray(cells) ? cells : Array.from(cells);

    const annos = []
    const annoNames = []
    
    for (const item of annoMatrix.schema.annotations?.obs?.columns) {
      if(item?.categories){
        let labels = await annoMatrix.fetch("obs",item.name)
        annos.push(labels)
        annoNames.push(item.name)
      }
    }
    const af = abortableFetch(
      `${API.prefix}${API.version}output`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          saveName: saveName,
          labelNames: annoNames,
          labels: annos,
          currentLayout: layoutChoice.current,
          filter: { obs: { index: cells } }
        }),
        credentials: "include",
      },
      6000000
    );
    dispatch({
      type: "output data: request start",
      abortableFetch: af,
    });
    const res = await af.ready();
    postAsyncSuccessToast("Data has been successfully saved.");
    dispatch({
      type: "output data: request completed",
    });
    if (res.ok && res.headers.get("Content-Type").includes("application/json")) {      
      return true;
    }

    // else an error
    let msg = `Unexpected HTTP response ${res.status}, ${res.statusText}`;
    const body = await res.text();
    if (body && body.length > 0) {
      msg = `${msg} -- ${body}`;
    }
    throw new Error(msg);
  } catch (error) {
    dispatch({
      type: "ouput data: request aborted",
    });
    if (error.name === "AbortError") {
      postAsyncFailureToast("Data output was aborted.");
    } else {
      postNetworkErrorToast(`Data output: ${error.message}`);
    }
  }
}

const setupWebSockets = (dispatch,getState,loggedIn,hostedMode) => {

  const onMessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.fail) {
      if (data.cfn === "diffexp") {
        dispatch({
          type: "request differential expression error",
        });
        postAsyncFailureToast("Differential expression error.");
      } else if (data.cfn === "reembedding") {
        dispatch({
          type: "reembed: request aborted",
        });        
        postAsyncFailureToast("Reembedding error.");
      } else if (data.cfn === "sankey") {
        dispatch({
          type: "sankey: request aborted",
        });        
        postAsyncFailureToast("Sankey calculation error.");
      } else if (data.cfn === "leiden") {
        dispatch({
          type: "leiden: request aborted",
        });        
        postAsyncFailureToast("Leiden clustering error.");
      } else if (data.cfn === "downloadAnndata") {
        dispatch({
          type: "output data: request aborted",
        });        
        postAsyncFailureToast("Data output error.");
      }

    } else if (data.cfn === "diffexp"){
      const { annoMatrix, genesets, differential } = getState();
      const { diffExpListsLists, diffExpListsNames } = genesets;
      const varIndexName = annoMatrix.schema.annotations.var.index;
      
      annoMatrix.fetch("var", varIndexName).then((varIndex)=>{
        const diffexpLists = { negative: [], positive: [] };
        for (const polarity of Object.keys(diffexpLists)) {
          diffexpLists[polarity] = data.response[polarity].map((v) => [
            varIndex.at(v[0], varIndexName),
            ...v.slice(1),
          ]);
        }
        if (!data?.multiplex) {
          dispatch({
            type: "request differential expression success",
            data: diffexpLists,
            dateString: data.groupName
          });      
          dispatch({type: "track set", group: `${data.groupName}//;;//`, set: null})
        } else if (data?.multiplex && data.num===differential.num) {
          diffExpListsLists.push(diffexpLists)
          diffExpListsNames.push(data.category)
          const diffExpListsMap = new Map();
          diffExpListsNames.forEach((name,ix) => {
            diffExpListsMap.set(name,diffExpListsLists[ix])
          })
          const dataList = [];
          const nameList = [];
          for (const name of data.nameList) {
            if(name!=="unassigned" && diffExpListsMap.has(name)){
              dataList.push(diffExpListsMap.get(name));
              nameList.push(name);
            }
          }
          dispatch({
            type: "request differential expression all success",
            dataList,
            nameList,
            dateString: data.dateString,
            grouping: data.grouping,
          });            
          dispatch({type: "request differential expression all completed"})      
          dispatch({type: "track set", group: `${data.grouping} (${data.dateString})//;;//`, set: null})          
        } else {
          dispatch({
            type: "request differential expression push list",
            data: diffexpLists,
            name: data.category
          });              
        }
      });  
    } else if (data.cfn === "reembedding"){
      const { layoutSchema: schema, schema: fullSchema } = data.response;
      dispatch({
        type: "reembed: request completed",
      });
      const {
        annoMatrix: prevAnnoMatrix,
        obsCrossfilter: prevCrossfilter,
        layoutChoice,
      } = getState();
      let flag = false;
      if (layoutChoice.available.length === 1 && layoutChoice.available[0] === "root") {
        flag = true;
      }
      const base = prevAnnoMatrix.base().addEmbedding(schema);

      await base.updateSchema(fullSchema)  
      
      dispatch({
        type: "reset subset"
      })
      let [annoMatrix, obsCrossfilter] = await _switchEmbedding(
        base,
        prevCrossfilter,
        layoutChoice.current,
        schema.name
      );
      
      [annoMatrix, obsCrossfilter] = dispatch(viewActions.resetSubsetAction({annoMatrix}))      
      dispatch({
        type: "reembed: add reembedding",
        schema,
        annoMatrix,
        obsCrossfilter,
      });
      dispatch({type: "refresh var metadata"})      
      if (flag) {
        dispatch({type: "reembed: delete reembedding", embName: "root"})
        const newAnnoMatrix = annoMatrix.dropObsmLayout("root")
        dispatch({type: "", annoMatrix: newAnnoMatrix})
        dispatch(embActions.requestDeleteEmbedding(["root"]))     
      }
      postAsyncSuccessToast("Re-embedding has completed.");

    } else if (data.cfn === "sankey"){
      const { layoutChoice } = getState();
      const catNames = data.catNames;
      const sankey = data.response;
      const threshold = data.threshold;
      const params = data.params;
      const cacheString = `${catNames.join(";")}_${layoutChoice.current}_${params.samHVG}_${params.sankeyMethod}_${params.dataLayer}_${params.selectedGenes.join(";")}_${params.geneMetadata}_${params.numEdges}`;

      dispatch({
        type: "sankey: request completed",
      });
      dispatch({
        type: "sankey: cache results",
        sankey,
        key: cacheString
      })
      const links = []
      const nodes = []
      let n = []
      sankey.edges.forEach(function (item, index) {
        if (sankey.weights[index] > threshold && item[0].split('_').slice(1).join('_') !== "unassigned" && item[1].split('_').slice(1).join('_') !== "unassigned"){
          links.push({
            source: item[0],
            target: item[1],
            value: sankey.weights[index]
          })
          n.push(item[0])
          n.push(item[1])
        }
      });   
      n = n.filter((item, i, ar) => ar.indexOf(item) === i);

      n.forEach(function (item){
        nodes.push({
          id: item
        })
      })
      const d = {links: links, nodes: nodes}
      dispatch({type: "sankey: set data",data: d})
    } else if (data.cfn === "leiden"){
      const { obsCrossfilter: prevObsCF } = getState();
      const val = data.response;
      const name = data.cName;
      dispatch({
        type: "leiden: request completed",
      });

      let prevObsCrossfilter;
      if (prevObsCF.annoMatrix.schema.annotations.obsByName[name]) {
        prevObsCrossfilter = prevObsCF.dropObsColumn(name);
      } else {
        prevObsCrossfilter = prevObsCF;
      }
      const initialValue = new Array(val);
      const df = new Dataframe([initialValue[0].length,1],initialValue)
      const { categories } = df.col(0).summarizeCategorical();
      if (!categories.includes(globals.unassignedCategoryLabel)) {
        categories.push(globals.unassignedCategoryLabel);
      }
      const ctor = initialValue.constructor;
      const newSchema = {
        name: name,
        type: "categorical",
        categories,
        writable: true,
      };     
      const arr = new Array(prevObsCrossfilter.annoMatrix.schema.dataframe.nObs).fill("unassigned");
      const index = prevObsCrossfilter.annoMatrix.rowIndex.labels()
      for (let i = 0; i < index.length; i++) {
        arr[index[i]] = val[i] ?? "what"
      }
      const obsCrossfilter = prevObsCrossfilter.addObsColumn(
        newSchema,
        ctor,
        arr
      );         
      dispatch({
        type: "annotation: create category",
        data: name,
        categoryToDuplicate: null,
        annoMatrix: obsCrossfilter.annoMatrix,
        obsCrossfilter,
      }); 
      dispatch({type: "track anno", anno: name})      
    } else if (data.cfn === "downloadAnndata"){
      if (hostedMode){
        const { layoutChoice } = getState();
        const a = document.createElement("a");
        a.href = data.response;
        a.style = "display: none";      
        a.download = `${layoutChoice.current}.h5ad`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);  
        
        dispatch({
          type: "output data: request completed",
        });            
        await sleep(10000);
        fetch(`${API.prefix}${API.version}downloadCallback?path=${data.response}`,
          {
            headers: new Headers({
              "Content-Type": "application/octet-stream",
            }),
            credentials: "include",
          })
      } else {
        postAsyncSuccessToast("Data output to the root directory.");
        dispatch({
          type: "output data: request completed",
        });            
      }
    }
  }   
  let wsDiffExp;
  let wsReembedding;
  let wsSankey;
  let wsLeiden;
  let wsDownloadAnndata;
  const urlschema = "wss://"
  // const urlschema = hostedMode ? "wss://" : "ws://";
  try{
    if (loggedIn || !hostedMode){
      wsDiffExp = new WebSocket(`${urlschema}${globals.API.prefix.split('/api').at(0).split('://').at(-1)}/diffexp`)
      wsDiffExp.onmessage = onMessage
      dispatch({type: "init: set up websockets",ws: wsDiffExp, name: "wsDiffExp"})    
    }
  } catch (e) {}
  try{
    if (loggedIn || !hostedMode){
      wsReembedding = new WebSocket(`${urlschema}${globals.API.prefix.split('/api').at(0).split('://').at(-1)}/reembedding`)
      wsReembedding.onmessage = onMessage
      dispatch({type: "init: set up websockets",ws: wsReembedding, name: "wsReembedding"})
    }
  } catch (e) {}
  try{
    if (loggedIn || !hostedMode){
      wsSankey = new WebSocket(`${urlschema}${globals.API.prefix.split('/api').at(0).split('://').at(-1)}/sankey`)
      wsSankey.onmessage = onMessage
      dispatch({type: "init: set up websockets",ws: wsSankey, name: "wsSankey"})
    }
  } catch (e) {}
  try{
    if (loggedIn || !hostedMode){
      wsLeiden = new WebSocket(`${urlschema}${globals.API.prefix.split('/api').at(0).split('://').at(-1)}/leiden`)
      wsLeiden.onmessage = onMessage
      dispatch({type: "init: set up websockets",ws: wsLeiden, name: "wsLeiden"})
    }
  } catch (e) {}
  try{
    if (loggedIn || !hostedMode){
      wsDownloadAnndata = new WebSocket(`${urlschema}${globals.API.prefix.split('/api').at(0).split('://').at(-1)}/downloadAnndata`)
      wsDownloadAnndata.onmessage = onMessage
      dispatch({type: "init: set up websockets",ws: wsDownloadAnndata, name: "wsDownloadAnndata"})
    }
  } catch (e) {}
  if (loggedIn || !hostedMode) {
    window.onbeforeunload = function() {
      wsDiffExp.onclose = function () {};
      wsDiffExp.close();
  
      wsReembedding.onclose = function () {};
      wsReembedding.close();
      
      wsSankey.onclose = function () {};
      wsSankey.close();
      
      wsLeiden.onclose = function () {};
      wsLeiden.close();
      
      wsDownloadAnndata.onclose = function () {};
      wsDownloadAnndata.close(); 
    };  
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const doInitialDataLoad = () =>
  catchErrorsWrap(async (dispatch, getState) => {
    dispatch({ type: "initial data load start" });
    await initializeFetch(dispatch);
    try {
      const [config, schema, res, res2, res3] = await Promise.all([
        configFetch(dispatch),
        schemaFetch(dispatch),
        userInfoAuth0Fetch(dispatch),
        hostedModeFetch(dispatch),
        jointModeFetch(dispatch),
        userColorsFetchAndLoad(dispatch),
        userInfoFetch(dispatch),
      ]);
      genesetsFetch(dispatch, config);
      reembedParamsFetch(dispatch);

      const { response: userInfo } = res;
      const { response: hostedMode, cxgMode } = res2;
      const { response: jointMode } = res3;
      if ( hostedMode ) {
        dispatch({type: "set user info", userInfo})
      } else {
        dispatch({type: "set user info", userInfo: {desktopMode: true}})
      }
      dispatch({type: "set cxg mode", cxgMode})
      dispatch({type: "set hosted mode", hostedMode})
      dispatch({type: "set joint mode", jointMode})
      const baseDataUrl = `${globals.API.prefix}${globals.API.version}`;  
      const annoMatrix = new AnnoMatrixLoader(baseDataUrl, schema.schema);
      
      const obsCrossfilter = new AnnoMatrixObsCrossfilter(annoMatrix);

      prefetchEmbeddings(annoMatrix);
      const allGenes = await annoMatrix.fetch("var","name_0")
      const layoutSchema = schema?.schema?.layout?.obs ?? [];
      if(layoutSchema.length > 0){
        const preferredNames = [schema?.schema?.rootName.split("X_").at(-1),"umap"];
        const f = layoutSchema.filter((i) => {
          return preferredNames.includes(i.name)
        })
        let name;
        if (f.length > 0) {
          name = f[0].name
        } else {
          name = layoutSchema[0].name
        }
        const base = annoMatrix.base();
        const [annoMatrixNew, obsCrossfilterNew] = await _switchEmbedding(
          base,
          obsCrossfilter,
          name,
          name
        ); 
        prefetchEmbeddings(annoMatrixNew);

        dispatch({
          type: "annoMatrix: init complete",
          annoMatrix: annoMatrixNew,
          obsCrossfilter: obsCrossfilterNew
        });        
        dispatch(embActions.layoutChoiceAction(name));        
      } else { 
        dispatch({
          type: "annoMatrix: init complete",
          annoMatrix,
          obsCrossfilter
        });
      }
      
      dispatch({ type: "initial data load complete", allGenes});
      setupWebSockets(dispatch,getState,userInfo ? true : false, hostedMode)      

    } catch (error) {
      dispatch({ type: "initial data load error", error });
    }
  }, true);

function requestSingleGeneExpressionCountsForColoringPOST(gene) {
  return {
    type: "color by expression",
    gene,
  };
}
export function fetchGeneInfo(gene,varMetadata) {
  return async (_dispatch, getState) => {
    const { layoutChoice } = getState();
    const res = await fetch(
      `${API.prefix}${API.version}geneInfo?gene=${gene}&varM=${varMetadata}&embName=${layoutChoice.current}`,
      {
         headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        credentials: "include",
      },
    );  
    const r = await res.json()
    return r.response;  
  }
}
export function requestDiffRename(oldName,newName) {
  return async (_dispatch, _getState) => {    
    const res = await fetch(
      `${API.prefix}${API.version}renameDiffExp`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          oldName: oldName,
          newName: newName
        }),
        credentials: "include",
      }
    );

    if (res.ok && res.headers.get("Content-Type").includes("application/json")) {
      return res;
    }
  }
}

export function requestSetRename(oldName,newName) {
  return async (_dispatch, _getState) => {    
    const res = await fetch(
      `${API.prefix}${API.version}renameSet`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          oldName: oldName,
          newName: newName
        }),
        credentials: "include",
      }
    );

    if (res.ok && res.headers.get("Content-Type").includes("application/json")) {
      return res;
    }
  }
}

export function requestGeneSetRename(group, newGroup, oldName,newName) {
  return async (_dispatch, _getState) => {    
    const res = await fetch(
      `${API.prefix}${API.version}renameGeneSet`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          set: group,
          newSet: newGroup,
          oldName: oldName,
          newName: newName
        }),
        credentials: "include",
      }
    );

    if (res.ok && res.headers.get("Content-Type").includes("application/json")) {
      return res;
    }
  }
}


export function requestSetDelete(name) {
  return async (_dispatch, _getState) => {    
    const res = await fetch(
      `${API.prefix}${API.version}deleteSet`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          name: name
        }),
        credentials: "include",
      }
    );

    if (res.ok && res.headers.get("Content-Type").includes("application/json")) {
      return res;
    }
  }
}

export function requestGeneSetDelete(group,name) {
  return async (_dispatch, _getState) => {    
    const res = await fetch(
      `${API.prefix}${API.version}deleteGeneSet`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          set: group,
          name: name
        }),
        credentials: "include",
      }
    );

    if (res.ok && res.headers.get("Content-Type").includes("application/json")) {
      return res;
    }
  }
}


export function requestDiffDelete(name) {
  return async (_dispatch, _getState) => {    
    const res = await fetch(
      `${API.prefix}${API.version}deleteDiffExp`,
      {
        method: "PUT",
        headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          name: name.split('//;;//').at(0)
        }),
        credentials: "include",
      }
    );

    if (res.ok && res.headers.get("Content-Type").includes("application/json")) {
      return res;
    }
  }
}

export function requestDiffExpPops(name,pop) {
  return async (_dispatch, _getState) => {  
    const res = await fetch(
      `${API.prefix}${API.version}diffExpPops?name=${encodeURIComponent(name)}&pop=${encodeURIComponent(pop)}`,
      {credentials: "include"}
    );
    const result = await res.json()
    if (res.ok && res.headers.get("Content-Type").includes("application/json")) {
      return result;
    }
  }
}

export function resetPools() {
  return (_dispatch, _getState) => {
    fetch(
      `${API.prefix}${API.version}adminRestart`,
      {
         headers: new Headers({
          Accept: "application/octet-stream",
          "Content-Type": "application/json",
        }),
        credentials: "include",
      },
    );   
  }
}

export function fetchGeneInfoBulk(geneSet,varMetadata) {
  return async (_dispatch, getState) => {
    if (varMetadata !== ""){
      const { layoutChoice } = getState();
      const res = await fetch(
        `${API.prefix}${API.version}geneInfoBulk`,
        {
          method: "PUT",
          headers: new Headers({
            Accept: "application/octet-stream",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            geneSet: geneSet,
            varMetadata: varMetadata,
            embName: layoutChoice.current
          }),
          credentials: "include",
        }
      );
      const r = await res.json()
      return r.response;  
    }
  }
}

const requestUserDefinedGene = (gene) => ({
  type: "request user defined gene success",
  data: {
    genes: [gene],
  },
});

const dispatchDiffExpErrors = (dispatch, response) => {
  switch (response.status) {
    case 403:
      dispatchNetworkErrorMessageToUser(
        "Too many cells selected for differential experesion calculation - please make a smaller selection."
      );
      break;
    case 501:
      dispatchNetworkErrorMessageToUser(
        "Differential expression is not implemented."
      );
      break;
    default: {
      const msg = `Unexpected differential expression HTTP response ${response.status}, ${response.statusText}`;
      dispatchNetworkErrorMessageToUser(msg);
      dispatch({
        type: "request differential expression error",
        error: new Error(msg),
      });
    }
  }
};

const requestDifferentialExpression = (set1, set2, num_genes = 100) => async (
  dispatch,
  getState
) => {
  try{
    dispatch({ type: "request differential expression started" });
  
    const { annoMatrix, controls } = getState();
    const { wsDiffExp } = controls;

    if (!set1) set1 = [];
    if (!set2) set2 = [];
    set1 = Array.isArray(set1) ? set1 : Array.from(set1);
    set2 = Array.isArray(set2) ? set2 : Array.from(set2);
    wsDiffExp.send(JSON.stringify({
      mode: "topN",
      count: num_genes,
      set1: { filter: { obs: { index: set1 } } },
      set2: { filter: { obs: { index: set2 } } },
      multiplex: false,
      layer: annoMatrix.layer,
      scale: annoMatrix.scale,
      groupName: new Date().toLocaleString().replace(/\//g,"_")

    }))
  } catch (error) {
    return dispatch({
      type: "request differential expression error",
      error,
    });
  }
}
const requestDifferentialExpressionAll = (num_genes = 100) => async (
  dispatch,
  getState
) => {
  dispatch({ type: "request differential expression all started" });

  try {
    /*
    Steps:
    1. for each category,
    2. get the most differentially expressed genes
    3. get expression data for each
    */
    const { annoMatrix, sankeySelection, controls } = getState();
    const { categories } = sankeySelection;
    const { wsDiffExp } = controls;

    let labels;
    let categoryName;
    for (const [key, value] of Object.entries(categories)) {
      if(value){
        labels = await annoMatrix.fetch("obs",key)
        categoryName = key;
      }
    }    
    labels = labels.__columns[0];
    const ix = annoMatrix.rowIndex.labels()
    const allCategories = annoMatrix.schema.annotations.obsByName[categoryName].categories
    let z = 0;
    const dateString = new Date().toLocaleString().replace(/\//g,'_');
    for ( let cat of allCategories ) {
      if (typeof cat === 'string' || cat instanceof String) {
        cat = cat.replace(/\//g,"_");
      }
      if (cat !== "unassigned"){
        let set1 = []
        let set2 = []
        for (let i = 0; i < labels.length; i++){
          if(labels[i] === cat){
            set1.push(ix[i])
          } else {
            set2.push(ix[i])
          }
        }
        if (set1.length > 1 && set2.length > 1) {
          z+=1;
          set1 = Array.isArray(set1) ? set1 : Array.from(set1);
          set2 = Array.isArray(set2) ? set2 : Array.from(set2);
          wsDiffExp.send(JSON.stringify({
            mode: "topN",
            count: num_genes,
            set1: { filter: { obs: { index: set1 } } },
            set2: { filter: { obs: { index: set2 } } },
            multiplex: true,
            grouping: categoryName.replace(/\//g,"_"),
            dateString: dateString,
            nameList: allCategories,
            layer: annoMatrix.layer,
            scale: annoMatrix.scale,            
            category: cat,
            num: z,
            groupName: `${categoryName} (${dateString})`.replace(/\//g,"_")
          }))
        }
      } 
    }
    dispatch({type: "request differential expression number of categories", num: z})
  } catch (error) {
    return dispatch({
      type: "request differential expression error",
      error,
    });
  }
};

const selectAll = () => async (dispatch, getState) => {
  dispatch({ type: "select all observations" });
  try {
    const { obsCrossfilter: prevObsCrossfilter } = getState();
    const obsCrossfilter = await prevObsCrossfilter.selectAll();
    return dispatch({
      type: "selected all observations",
      obsCrossfilter,
    });
  } catch (error) {
    return dispatch({
      type: "error selecting all observations",
      error,
    });
  }
};

function fetchJson(pathAndQuery) {
  return doJsonRequest(
    `${globals.API.prefix}${globals.API.version}${pathAndQuery}`
  );
}

export default {
  schemaFetch,
  requestDiffRename,
  requestDiffDelete,
  requestSetRename,
  requestSetDelete,
  requestGeneSetRename,
  requestGeneSetDelete,    
  fetchGeneInfo,
  fetchGeneInfoBulk,
  resetPools,
  requestDiffExpPops,
  prefetchEmbeddings,
  reembedParamsObsmFetch,
  requestDifferentialExpressionAll,
  doInitialDataLoad,
  selectAll,
  requestDifferentialExpression,
  requestSingleGeneExpressionCountsForColoringPOST,
  requestUserDefinedGene,
  requestReembed,
  requestPreprocessing,
  requestSankey,
  requestLeiden,
  downloadData,
  downloadMetadata,
  downloadGenedata,
  requestSaveAnndataToFile,
  downloadVarMetadata,
  selectCellsFromArray: selnActions.selectCellsFromArray,
  setCellsFromSelectionAndInverseAction:
    selnActions.setCellsFromSelectionAndInverseAction,
  selectContinuousMetadataAction: selnActions.selectContinuousMetadataAction,
  selectCategoricalMetadataAction: selnActions.selectCategoricalMetadataAction,
  selectCategoricalAllMetadataAction:
    selnActions.selectCategoricalAllMetadataAction,
  graphBrushStartAction: selnActions.graphBrushStartAction,
  graphBrushChangeAction: selnActions.graphBrushChangeAction,
  graphBrushDeselectAction: selnActions.graphBrushDeselectAction,
  graphBrushCancelAction: selnActions.graphBrushCancelAction,
  graphBrushEndAction: selnActions.graphBrushEndAction,
  graphLassoStartAction: selnActions.graphLassoStartAction,
  graphLassoEndAction: selnActions.graphLassoEndAction,
  graphLassoCancelAction: selnActions.graphLassoCancelAction,
  graphLassoDeselectAction: selnActions.graphLassoDeselectAction,
  clipAction: viewActions.clipAction,
  subsetAction: viewActions.subsetAction,
  resetSubsetAction: viewActions.resetSubsetAction,
  annotationCreateCategoryAction: annoActions.annotationCreateCategoryAction,
  annotationRenameCategoryAction: annoActions.annotationRenameCategoryAction,
  annotationDeleteCategoryAction: annoActions.annotationDeleteCategoryAction,
  annotationCreateLabelInCategory: annoActions.annotationCreateLabelInCategory,
  requestFuseLabels: annoActions.requestFuseLabels,
  requestDeleteLabels: annoActions.requestDeleteLabels,
  annotationDeleteLabelFromCategory:
    annoActions.annotationDeleteLabelFromCategory,
  annotationRenameLabelInCategory: annoActions.annotationRenameLabelInCategory,
  annotationLabelCurrentSelection: annoActions.annotationLabelCurrentSelection,
  saveObsAnnotationsAction: annoActions.saveObsAnnotationsAction,
  saveGenesetsAction: annoActions.saveGenesetsAction,
  saveReembedParametersAction: annoActions.saveReembedParametersAction,
  layoutChoiceAction: embActions.layoutChoiceAction,
  requestDeleteEmbedding: embActions.requestDeleteEmbedding,
  requestRenameEmbedding: embActions.requestRenameEmbedding,
  setCellSetFromSelection: selnActions.setCellSetFromSelection,
  setCellSetFromInputArray: selnActions.setCellSetFromInputArray,
  genesetDelete: genesetActions.genesetDelete,
  genesetDeleteGroup: genesetActions.genesetDeleteGroup,
  genesetAddGenes: genesetActions.genesetAddGenes,
  genesetDeleteGenes: genesetActions.genesetDeleteGenes,
};
