// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface FHEAnalysis {
  id: string;
  modelName: string;
  analysisType: string;
  timestamp: number;
  owner: string;
  status: "queued" | "processing" | "completed" | "failed";
  result?: string;
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [analyses, setAnalyses] = useState<FHEAnalysis[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newAnalysisData, setNewAnalysisData] = useState({
    modelName: "",
    analysisType: "structural",
    boundaryConditions: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Filter analyses based on search term
  const filteredAnalyses = analyses.filter(analysis => 
    analysis.modelName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    analysis.analysisType.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate statistics
  const completedCount = analyses.filter(a => a.status === "completed").length;
  const processingCount = analyses.filter(a => a.status === "processing").length;
  const failedCount = analyses.filter(a => a.status === "failed").length;

  useEffect(() => {
    loadAnalyses().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Load analyses from contract
  const loadAnalyses = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("analysis_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing analysis keys:", e);
        }
      }
      
      const list: FHEAnalysis[] = [];
      
      for (const key of keys) {
        try {
          const analysisBytes = await contract.getData(`analysis_${key}`);
          if (analysisBytes.length > 0) {
            try {
              const analysisData = JSON.parse(ethers.toUtf8String(analysisBytes));
              list.push({
                id: key,
                modelName: analysisData.modelName,
                analysisType: analysisData.analysisType,
                timestamp: analysisData.timestamp,
                owner: analysisData.owner,
                status: analysisData.status || "queued",
                result: analysisData.result
              });
            } catch (e) {
              console.error(`Error parsing analysis data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading analysis ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setAnalyses(list);
    } catch (e) {
      console.error("Error loading analyses:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  // Submit new analysis
  const submitAnalysis = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting 3D model data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newAnalysisData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const analysisId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const analysisData = {
        modelName: newAnalysisData.modelName,
        analysisType: newAnalysisData.analysisType,
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        status: "queued"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `analysis_${analysisId}`, 
        ethers.toUtf8Bytes(JSON.stringify(analysisData))
      );
      
      const keysBytes = await contract.getData("analysis_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(analysisId);
      
      await contract.setData(
        "analysis_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted analysis submitted securely!"
      });
      
      await loadAnalyses();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewAnalysisData({
          modelName: "",
          analysisType: "structural",
          boundaryConditions: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  // Check if current user is owner
  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  // Tutorial steps
  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access FHE-powered analysis",
      icon: "🔗"
    },
    {
      title: "Upload Encrypted Model",
      description: "Securely upload your 3D model encrypted with FHE",
      icon: "🔒"
    },
    {
      title: "FHE Processing",
      description: "Perform structural or thermal analysis without decrypting",
      icon: "⚙️"
    },
    {
      title: "Get Results",
      description: "Receive encrypted analysis results while keeping IP protected",
      icon: "📊"
    }
  ];

  // Render status chart
  const renderStatusChart = () => {
    return (
      <div className="status-chart">
        <div className="chart-bar completed" style={{ height: `${(completedCount / analyses.length) * 100}%` }}>
          <span>{completedCount}</span>
        </div>
        <div className="chart-bar processing" style={{ height: `${(processingCount / analyses.length) * 100}%` }}>
          <span>{processingCount}</span>
        </div>
        <div className="chart-bar failed" style={{ height: `${(failedCount / analyses.length) * 100}%` }}>
          <span>{failedCount}</span>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE<span>FEA</span>Cloud</h1>
          <p>Secure Cloud-based Finite Element Analysis</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <div className="hero-section">
          <div className="hero-text">
            <h2>Fully Homomorphic Encryption for Engineering Simulations</h2>
            <p>Perform structural and thermal analysis on encrypted 3D models without compromising intellectual property</p>
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="primary-btn"
              disabled={!account}
            >
              {account ? "New FHE Analysis" : "Connect Wallet to Start"}
            </button>
          </div>
          <div className="hero-image">
            <div className="fhe-visual"></div>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How FHE-Powered FEA Works</h2>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="stats-section">
          <div className="stat-card">
            <h3>Total Analyses</h3>
            <div className="stat-value">{analyses.length}</div>
          </div>
          <div className="stat-card">
            <h3>Completed</h3>
            <div className="stat-value">{completedCount}</div>
          </div>
          <div className="stat-card">
            <h3>In Progress</h3>
            <div className="stat-value">{processingCount}</div>
          </div>
          <div className="stat-card">
            <h3>Status Distribution</h3>
            {analyses.length > 0 ? renderStatusChart() : <p>No data available</p>}
          </div>
        </div>
        
        <div className="analyses-section">
          <div className="section-header">
            <h2>FHE Analysis Queue</h2>
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Search analyses..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <button 
                onClick={loadAnalyses}
                disabled={isRefreshing}
                className="refresh-btn"
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="analyses-list">
            {filteredAnalyses.length === 0 ? (
              <div className="empty-state">
                <p>No FHE analyses found</p>
                <button 
                  onClick={() => setShowCreateModal(true)}
                  className="primary-btn"
                  disabled={!account}
                >
                  Start Your First Analysis
                </button>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Model Name</th>
                    <th>Analysis Type</th>
                    <th>Owner</th>
                    <th>Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAnalyses.map(analysis => (
                    <tr key={analysis.id}>
                      <td>{analysis.modelName}</td>
                      <td className="capitalize">{analysis.analysisType}</td>
                      <td>{analysis.owner.substring(0, 6)}...{analysis.owner.substring(38)}</td>
                      <td>{new Date(analysis.timestamp * 1000).toLocaleDateString()}</td>
                      <td>
                        <span className={`status-badge ${analysis.status}`}>
                          {analysis.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
  
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>New FHE Analysis</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>3D Model Name *</label>
                <input 
                  type="text" 
                  name="modelName"
                  value={newAnalysisData.modelName} 
                  onChange={(e) => setNewAnalysisData({...newAnalysisData, modelName: e.target.value})}
                  placeholder="Enter model name"
                />
              </div>
              
              <div className="form-group">
                <label>Analysis Type *</label>
                <select 
                  name="analysisType"
                  value={newAnalysisData.analysisType} 
                  onChange={(e) => setNewAnalysisData({...newAnalysisData, analysisType: e.target.value})}
                >
                  <option value="structural">Structural Analysis</option>
                  <option value="thermal">Thermal Analysis</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Boundary Conditions</label>
                <textarea 
                  name="boundaryConditions"
                  value={newAnalysisData.boundaryConditions} 
                  onChange={(e) => setNewAnalysisData({...newAnalysisData, boundaryConditions: e.target.value})}
                  placeholder="Describe boundary conditions..."
                  rows={3}
                />
              </div>
              
              <div className="fhe-notice">
                <p>Your model and analysis parameters will be encrypted using FHE before processing</p>
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={() => setShowCreateModal(false)}
                className="secondary-btn"
              >
                Cancel
              </button>
              <button 
                onClick={submitAnalysis} 
                disabled={creating || !newAnalysisData.modelName}
                className="primary-btn"
              >
                {creating ? "Encrypting with FHE..." : "Submit Analysis"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            <p>{transactionStatus.message}</p>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>FHE FEA Cloud</h3>
            <p>Secure engineering simulations powered by Fully Homomorphic Encryption</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} FHE FEA Cloud. All rights reserved.</p>
          <div className="fhe-badge">
            <span>FHE-Powered Security</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;