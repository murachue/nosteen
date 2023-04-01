import { Outlet } from "react-router";
import { Link } from "react-router-dom";

const MainLayout = () => <>
    <div style={{
        // border: "1px solid white",
        position: "absolute",
        top: "0",
        left: "0",
        transformOrigin: "0 0",
        transform: "rotate(270deg) translate(-100%,-100%)",
    }}><Link to="/preferences" style={{ color: "#ccc" }}>Prefs</Link></div>
    <Outlet />
</>;

export default MainLayout;
