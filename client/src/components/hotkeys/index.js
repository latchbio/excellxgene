import { useHotkeys, InputGroup } from "@blueprintjs/core";
import React, { createRef, useMemo } from "react";
import actions from "../../actions";
import { subsetAction, resetSubsetAction } from "../../actions/viewStack";
export const GlobalHotkeys = (props) => {
  const { dispatch } = props;
  const inputRef = createRef();
  let zPressed = false;
  const hotkeys = useMemo(
    () => [
      {
        combo: "Z",
        global: true,
        label: "Hold to use multiple selection lassos.",
        onKeyDown: () => {
          if (!zPressed) {
            zPressed = true;
            dispatch({ type: "graph: lasso multi-selection on" });
          }
        },
        onKeyUp: () => {
          zPressed = false;
          dispatch({ type: "graph: lasso multi-selection off" });
        },
      },
      {
        combo: "SHIFT+W",
        global: true,
        label: "Subset to selection.",
        onKeyDown: () => {
          dispatch(subsetAction())

        },
      },  
      {
        combo: "SHIFT+E",
        global: true,
        label: "Unsubset selection.",
        onKeyDown: () => {
          dispatch(resetSubsetAction())
        },
      },            
    ],
    []
  );
  const { handleKeyDown, handleKeyUp } = useHotkeys(hotkeys);

  return (
    <div
      role="tab"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      style={{
        display: "none"
      }}      
    >
      <InputGroup inputRef={inputRef} />
    </div>
  );
};

export const DgeHotkeys = (props) => {
  const { dispatch, differential } = props;
  const inputRef = createRef();
  const hotkeys = useMemo(
    () => [
      {
        combo: "SHIFT+I",
        global: true,
        label:
          "Set the current selection and its inverse to cell sets 1 and 2, respectively.",
        onKeyDown: () =>
          dispatch(actions.setCellsFromSelectionAndInverseAction()),
      },
      {
        combo: "SHIFT+1",
        global: true,
        label: "Set current selection to cell set 1.",
        onKeyDown: () => dispatch(actions.setCellSetFromSelection(1)),
      },
      {
        combo: "SHIFT+2",
        global: true,
        label: "Set current selection to cell set 2.",
        onKeyDown: () => dispatch(actions.setCellSetFromSelection(2)),
      },      
      {
        combo: "SHIFT+D",
        global: true,
        label: "Run differential expression.",
        onKeyDown: () =>
        {
          if ((differential.celllist1?.length ?? 0 > 0) && (differential.celllist2?.length ?? 0 > 0)) {
            dispatch(
              actions.requestDifferentialExpression(
                differential.celllist1,
                differential.celllist2
              )
            )
          }      
        }
      },
    ],
    [differential]
  );
  const { handleKeyDown, handleKeyUp } = useHotkeys(hotkeys);

  return (
    <div
      role="tab"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      style={{
        display: "none"
      }}
    >
      <InputGroup inputRef={inputRef} />
    </div>
  );
};
export const GenesetHotkeys = (props) => {
  const { dispatch, genesets } = props;
  const inputRef = createRef();
  const hotkeys = useMemo(
    () => [
      {
        combo: "SHIFT+Q",
        global: true,
        label: "Delete the most recent geneset group.",
        onKeyDown: async () => {
          const group = Object.keys(genesets).filter(item => item !== "")[0];
          if (group) {
            dispatch({
              type: "color by nothing"
            });
            dispatch(actions.genesetDeleteGroup(group));
          }
        },
      },
      {
        combo: "SHIFT+G",
        global: true,
        label: "Delete the most recent ungrouped geneset.",
        onKeyDown: async () => {
          let geneset;
          if ("" in genesets) {
            geneset = Object.keys(genesets[""])[0];
          }
          if (geneset) {
            dispatch({
              type: "color by nothing"
            });
            dispatch(actions.genesetDelete("", geneset));
          }
        },
      },      
    ],
    [genesets]
  );
  const { handleKeyDown, handleKeyUp } = useHotkeys(hotkeys);

  return (
    <div
      role="tab"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      style={{
        display: "none"
      }}      
    >
      <InputGroup inputRef={inputRef} />
    </div>
  );
};
