import React from 'react';
import ReactDOM from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import ErrorPage from './routes/errorpage';
import Global from './routes/global';
import MainLayout from './routes/mainlayout';
import TabsView from './routes/tabsview';
import App from './routes/test';

let state = {
    preferences: {},
    events: [],
    tabs: [],
};

const router = createHashRouter([
    {
        element: <Global />,
        errorElement: <ErrorPage />,
        children: [
            {
                element: <MainLayout />,
                children: [
                    {
                        path: '/:name?',
                        loader: ({ params }) => params,
                        element: <TabsView />,
                    },
                    {
                        path: 'test',
                        element: <App />,
                    }
                ],
            },
        ],
    },
]);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <RouterProvider router={router} />
    </React.StrictMode>,
);
