import { Outlet } from "react-router";

const Root = () => <div>
    <div style={{ width: "800px", height: "400px", margin: "auto", overflow: "auto", border: "1px solid white" }}>
        <Outlet />
    </div>
</div>;

export default Root;
