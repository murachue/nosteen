import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import state from "../state";
import { useEffect } from "react";

export default () => {
    const navigate = useNavigate();
    const [tabs] = useAtom(state.tabs);

    useEffect(() => {
        navigate(`/tab/${tabs[0].name}`);
    }, []);

    return <></>;
};
